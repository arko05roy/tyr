// PRD 5.1/5.3 — Flow A: place a bet.
//
// Source of truth for funds: the user's Solana CONFIDENTIAL tyrUSD balance is the bankroll.
// The Tempo leg is limit enforcement: a stake authorization (AlphaUSD user → treasury, through
// the access key) that the chain rejects above the loss limit; it is credited back on settlement.
//
// Saga steps (Order.step = last completed): created → staked → escrowed → opened → executed.
// Each step persists its tx before advancing, so retrying with the same idempotencyKey resumes.
// Compensation: if the venue fills nothing, the stake is refunded on both chains and the position is
// settled on Solana as `refunded`.
//
// Phase 11b: a bet targets any venue market (`marketId = venue:nativeId`; `outcome` is the legacy HL
// shorthand). Hyperliquid executes through the Phase 4 executor; other venues through their adapter.
// The Tempo, Solana and settlement legs are the same for every venue.
import type { PrismaClient } from '@tyr/db';
import {
  MIN_ORDER_USD,
  bookFor,
  builderCode,
  executeOrder,
  featuredMarkets,
  type Executor,
  type OutcomeSide,
} from '@tyr/hyperliquid';
import {
  confidentialTransfer,
  escrowKeys,
  openPositionIx,
  orderId32,
  sendAtomic,
  treasury,
} from '@tyr/solana';
import { LimitExceededError, debitStake, memo32 } from '@tyr/tempo';
import { parseMarketId, solanaMarketId } from '@tyr/venues';
import { availableBalance, confidentialAccount } from './accounts.js';
import { emit } from './events.js';
import { commit, ensureMarketRegistered, fromUnits, units } from './market.js';
import { refundOrder } from './settle.js';
import { fillFields, hlOutcome, isHl, resolveMarketId, venues } from './venue.js';

export type BetInput = {
  userId: string;
  /** venue market id `venue:nativeId`; takes precedence over `outcome` */
  marketId?: string | undefined;
  /** legacy shorthand for `hyperliquid:<outcome>` */
  outcome?: number | undefined;
  side: 'yes' | 'no';
  stakeUsd: number;
  idempotencyKey: string;
  /** worst price per contract the user accepts (0–1); defaults to best ask + 2% */
  maxPrice?: number | undefined;
  /**
   * bankroll (Flow A): the user's confidential balance pays, Tempo enforces the limit.
   * float (Flow B, Zcash): the user already paid in shielded ZEC to tyr, so tyr's float covers the
   * HL order — no Tempo stake and no confidential user → escrow leg; the order starts at
   * `escrowed` and still opens a real Solana position before executing.
   * prepaid (Flow C, agents): the stake authorization already landed on Tempo as the agent's MPP
   * payment (`stakeTx`, capped by its access key); the order starts at `staked`.
   */
  funding?: 'bankroll' | 'float' | 'prepaid';
  stakeTx?: string | undefined;
  agentSessionId?: string | undefined;
  /** set by placeRoutedBet: the legs of one routed bet share it */
  routeKey?: string | undefined;
};

export class BetRejectedError extends Error {
  constructor(
    message: string,
    readonly code: 'market' | 'size' | 'balance' | 'limit',
  ) {
    super(message);
  }
}

const MAX_SLIPPAGE = 0.02;
const sideIndex = (s: 'yes' | 'no'): OutcomeSide => (s === 'yes' ? 0 : 1);

/** Contracts we can afford at limitPx including the builder fee; integer, cost ≤ stake. */
export function sizeFor(stakeUsd: number, limitPx: number, feeTenthsBps: number) {
  return Math.floor(stakeUsd / (limitPx * (1 + feeTenthsBps / 100_000)));
}

/** Contracts affordable at limitPx including a venue's (possibly non-linear) taker fee. */
export function sizeForVenue(
  stakeUsd: number,
  limitPx: number,
  fee: (px: number, sz: number) => number,
) {
  // cost is monotone in sz; binary search the largest sz that fits (per-trade rounding such as
  // Kalshi's ceil makes the size-1 fee a poor per-contract estimate)
  const fits = (sz: number) => sz * limitPx + fee(limitPx, sz) <= stakeUsd + 1e-9;
  let lo = 0;
  let hi = Math.floor(stakeUsd / limitPx);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function quote(input: BetInput) {
  let id: string;
  try {
    id = resolveMarketId(input);
  } catch (e) {
    throw new BetRejectedError((e as Error).message, 'market');
  }
  return isHl(id) ? quoteHl(input, hlOutcome(id)) : quoteVenue(input, id);
}

async function quoteVenue(input: BetInput, id: string) {
  const { venue: vid, nativeId } = parseMarketId(id);
  let venue;
  try {
    venue = venues().venue(vid);
  } catch {
    throw new BetRejectedError(`unknown venue ${vid}`, 'market');
  }
  const m = await venue.market(nativeId);
  if (!m || m.resolvesAt <= new Date().toISOString())
    throw new BetRejectedError(`${id} is not an open market`, 'market');
  const ask = (await venue.book(nativeId, input.side)).asks[0];
  if (!ask) throw new BetRejectedError('no asks on that side', 'market');
  const slipped = Math.min(0.999, Number((ask.px * (1 + MAX_SLIPPAGE)).toFixed(4)));
  const limitPx = Math.min(slipped, input.maxPrice ?? 1);
  const sz = sizeForVenue(input.stakeUsd, limitPx, (px, n) => venue.takerFee(px, n));
  if (sz * limitPx < venue.info.minOrderUsd)
    throw new BetRejectedError(
      `${venue.info.name} minimum order is $${venue.info.minOrderUsd}`,
      'size',
    );
  return { marketId: id, limitPx, sz };
}

async function quoteHl(input: BetInput, outcome: number) {
  const featured = await featuredMarkets();
  if (!featured.some((m) => m.outcome === outcome))
    throw new BetRejectedError(`outcome ${outcome} is not a featured live market`, 'market');
  const ask = (await bookFor(outcome, sideIndex(input.side))).levels[1][0];
  if (!ask) throw new BetRejectedError('no asks on that side', 'market');
  const slipped = Math.min(0.999, Number((Number(ask.px) * (1 + MAX_SLIPPAGE)).toFixed(4)));
  const limitPx = Math.min(slipped, input.maxPrice ?? 1);
  const sz = sizeFor(input.stakeUsd, limitPx, builderCode().f);
  if (sz * limitPx < MIN_ORDER_USD)
    throw new BetRejectedError(`Hyperliquid minimum order is $${MIN_ORDER_USD}`, 'size');
  return { marketId: `hyperliquid:${outcome}`, limitPx, sz };
}

/** Validate market, size and bankroll without side effects — run before taking an agent's payment. */
export async function preflightBet(db: PrismaClient, input: BetInput) {
  const q = await quote(input);
  if (input.funding !== 'float') {
    const keys = await confidentialAccount(db, input.userId);
    if ((await availableBalance(keys)) < units(input.stakeUsd))
      throw new BetRejectedError('insufficient confidential balance', 'balance');
  }
  return q;
}

export async function placeBet(db: PrismaClient, exec: Executor, input: BetInput) {
  let order = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (order && order.userId !== input.userId)
    throw new Error('idempotency key belongs to another user');

  const stake = units(input.stakeUsd);
  const keys = await confidentialAccount(db, input.userId);
  const float = input.funding === 'float';
  if (input.funding === 'prepaid' && !input.stakeTx) throw new Error('prepaid bet needs stakeTx');

  if (!order) {
    const q = await quote(input);
    if (!float && (await availableBalance(keys)) < stake)
      throw new BetRejectedError('insufficient confidential balance', 'balance');
    const { salt } = commit(stake);
    order = await db.order.create({
      data: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        marketId: q.marketId,
        hlMarket: isHl(q.marketId) ? String(hlOutcome(q.marketId)) : null,
        routeKey: input.routeKey ?? null,
        side: input.side,
        size: q.sz,
        price: q.limitPx,
        stakeUsd: fromUnits(stake),
        stakeSalt: salt,
        status: 'pending',
        ...(float ? { step: 'escrowed' } : {}),
        ...(input.funding === 'prepaid'
          ? { step: 'staked', tempoStakeTx: input.stakeTx ?? null }
          : {}),
        ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
      },
    });
  }
  const id = order.id;
  const mid = order.marketId;
  const advance = async (step: string, data: Record<string, unknown> = {}) => {
    order = await db.order.update({ where: { id }, data: { step, ...data } });
    emit({ type: 'order', userId: order.userId, orderId: id, step, status: order.status });
  };

  // 1. Tempo stake authorization — the chain enforces the loss limit.
  if (order.step === 'created') {
    try {
      const tx = await debitStake(db, {
        userId: input.userId,
        amount: stake,
        memo: memo32(`stake:${id}`),
      });
      await advance('staked', { tempoStakeTx: tx });
    } catch (err) {
      if (!(err instanceof LimitExceededError)) throw err;
      await advance('blocked', { status: 'blocked', error: err.message });
      throw new BetRejectedError(err.message, 'limit');
    }
  }

  // 2. Bankroll debit: confidential transfer user → escrow (amount encrypted on-chain).
  if (order.step === 'staked') {
    const sigs = await confidentialTransfer(keys, (await escrowKeys()).owner.address, stake);
    await advance('escrowed', { escrowTx: sigs.at(-1) });
  }

  // 3. Position PDA links order id ↔ salted size commitment (no plaintext size on-chain).
  if (order.step === 'escrowed') {
    const onchainId = solanaMarketId(mid);
    await ensureMarketRegistered(onchainId);
    const relayer = await treasury();
    const sig = await sendAtomic(
      [
        await openPositionIx({
          relayer,
          user: keys.owner.address,
          marketId: onchainId,
          orderId: orderId32(id),
          side: sideIndex(input.side),
          sizeCommitment: commit(stake, order.stakeSalt ?? undefined).commitment,
        }),
      ],
      relayer,
    );
    await advance('opened', { solanaOpenTx: sig });
  }

  // 4a. Other venues: execute through the adapter (simulated adapters return simulated fills).
  if (order.step === 'opened' && !isHl(mid)) {
    const { venue } = parseMarketId(mid);
    const f = await venues()
      .venue(venue)
      .execute({
        marketId: mid,
        side: input.side,
        sz: Number(order.size),
        limitPx: Number(order.price),
      });
    order = await db.order.update({ where: { id }, data: fillFields(f) });
    await advance('executed');
    if (Number(order.filledSize) === 0)
      await refundOrder(
        db,
        id,
        `no fill on ${venue} (${f.status}${f.error ? `: ${f.error}` : ''})`,
      );
  }

  // 4b. HL execution from the pooled float (paper or live — Executor decides).
  if (order.step === 'opened') {
    const req = {
      outcome: hlOutcome(mid),
      side: sideIndex(input.side),
      isBuy: true,
      sz: Number(order.size),
      limitPx: Number(order.price),
      tif: 'Ioc' as const,
    };
    order = await executeOrder(db, exec, id, req);
    await advance('executed');
    if (Number(order.filledSize) === 0)
      await refundOrder(
        db,
        id,
        `no fill on Hyperliquid (${order.status}${order.execution && typeof order.execution === 'object' && 'error' in order.execution ? `: ${String(order.execution.error)}` : ''})`,
      );
  }

  return db.order.findUniqueOrThrow({ where: { id }, include: { settlement: true } });
}
