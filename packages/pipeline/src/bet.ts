// PRD 5.1/5.3 — Flow A: place a bet.
//
// Source of truth for funds: the user's Solana CONFIDENTIAL tyrUSD balance is the bankroll.
// The Tempo leg is limit enforcement: a stake authorization (AlphaUSD user → treasury, through
// the access key) that the chain rejects above the loss limit; it is credited back on settlement.
//
// Saga steps (Order.step = last completed): created → staked → escrowed → opened → executed.
// Each step persists its tx before advancing, so retrying with the same idempotencyKey resumes.
// Compensation: if HL fills nothing, the stake is refunded on both chains and the position is
// settled on Solana as `refunded`.
import type { PrismaClient } from '@tyr/db';
import {
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
import { availableBalance, confidentialAccount } from './accounts.js';
import { emit } from './events.js';
import { commit, ensureMarketRegistered, fromUnits, units } from './market.js';
import { refundOrder } from './settle.js';

export type BetInput = {
  userId: string;
  outcome: number;
  side: 'yes' | 'no';
  stakeUsd: number;
  idempotencyKey: string;
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

async function quote(input: BetInput) {
  const featured = await featuredMarkets();
  if (!featured.some((m) => m.outcome === input.outcome))
    throw new BetRejectedError(`outcome ${input.outcome} is not a featured live market`, 'market');
  const ask = (await bookFor(input.outcome, sideIndex(input.side))).levels[1][0];
  if (!ask) throw new BetRejectedError('no asks on that side', 'market');
  const limitPx = Math.min(0.999, Number((Number(ask.px) * (1 + MAX_SLIPPAGE)).toFixed(4)));
  const sz = sizeFor(input.stakeUsd, limitPx, builderCode().f);
  if (sz < 1) throw new BetRejectedError(`stake too small for 1 contract at ${limitPx}`, 'size');
  return { limitPx, sz };
}

export async function placeBet(db: PrismaClient, exec: Executor, input: BetInput) {
  let order = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (order && order.userId !== input.userId)
    throw new Error('idempotency key belongs to another user');

  const stake = units(input.stakeUsd);
  const keys = await confidentialAccount(db, input.userId);

  if (!order) {
    const q = await quote(input);
    if ((await availableBalance(keys)) < stake)
      throw new BetRejectedError('insufficient confidential balance', 'balance');
    const { salt } = commit(stake);
    order = await db.order.create({
      data: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        hlMarket: String(input.outcome),
        side: input.side,
        size: q.sz,
        price: q.limitPx,
        stakeUsd: fromUnits(stake),
        stakeSalt: salt,
        status: 'pending',
      },
    });
  }
  const id = order.id;
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
    await ensureMarketRegistered(input.outcome);
    const relayer = await treasury();
    const sig = await sendAtomic(
      [
        await openPositionIx({
          relayer,
          user: keys.owner.address,
          marketId: BigInt(input.outcome),
          orderId: orderId32(id),
          side: sideIndex(input.side),
          sizeCommitment: commit(stake, order.stakeSalt ?? undefined).commitment,
        }),
      ],
      relayer,
    );
    await advance('opened', { solanaOpenTx: sig });
  }

  // 4. HL execution from the pooled float (paper or live — Executor decides).
  if (order.step === 'opened') {
    const req = {
      outcome: input.outcome,
      side: sideIndex(input.side),
      isBuy: true,
      sz: Number(order.size),
      limitPx: Number(order.price),
      tif: 'Ioc' as const,
    };
    order = await executeOrder(db, exec, id, req);
    await advance('executed');
    if (Number(order.filledSize) === 0) await refundOrder(db, id, 'no fill on Hyperliquid');
  }

  return db.order.findUniqueOrThrow({ where: { id }, include: { settlement: true } });
}
