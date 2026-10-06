// PRD 5.2/5.3 — settlement and compensation for Flow A orders.
//   payout = proceeds + (stake − entry cost − entry builder fee)
//   resolved: proceeds = filled contracts × 1 if the bet's side won, else 0
//   closed:   proceeds = real close orders (IOC sells into the live bid book) − their builder fees
//   refunded: proceeds = 0, cost = 0 → full stake back
// Every chain write is persisted on the Settlement row first-time-only, so retries resume.
import type { PrismaClient } from '@tyr/db';
import { bookFor, placeOrder, type Executor, type OutcomeSide } from '@tyr/hyperliquid';
import {
  confidentialTransfer,
  orderId32,
  sendAtomic,
  settlePositionIx,
  treasury,
} from '@tyr/solana';
import { payout } from '@tyr/tempo';
import { parseMarketId, solanaMarketId } from '@tyr/venues';
import type { Address } from 'viem';
import { confidentialAccount, ensureEscrowLiquidity } from './accounts.js';
import { emit } from './events.js';
import { OUTCOME, commit, fromUnits, units } from './market.js';
import { hlOutcome, isHl, placeVenueOrder, venues } from './venue.js';

export type Resolution = { kind: 'resolved'; winner: OutcomeSide } | { kind: 'close' };

const CLOSE_SLIPPAGE = 0.1;
const CLOSE_ROUNDS = 3;

type Final = { label: keyof typeof OUTCOME; payout: bigint; closeOrderId?: string };

async function finalize(db: PrismaClient, orderId: string, f: Final) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { user: true },
  });
  const stake = units(Number(order.stakeUsd ?? 0));
  let s =
    (await db.settlement.findUnique({ where: { orderId } })) ??
    (await db.settlement.create({
      data: {
        orderId,
        outcome: f.label,
        payoutUsd: fromUnits(f.payout),
        payoutSalt: commit(f.payout).salt,
        pnl: fromUnits(f.payout - stake),
        closeOrderId: f.closeOrderId ?? null,
      },
    }));
  const amount = units(Number(s.payoutUsd));
  const keys = await confidentialAccount(db, order.userId);

  if (!s.solanaTx && order.solanaOpenTx) {
    const relayer = await treasury();
    const sig = await sendAtomic(
      [
        await settlePositionIx({
          relayer,
          user: keys.owner.address,
          marketId: solanaMarketId(order.marketId),
          orderId: orderId32(orderId),
          outcome: OUTCOME[s.outcome as keyof typeof OUTCOME],
          payoutCommitment: commit(amount, s.payoutSalt ?? undefined).commitment,
        }),
      ],
      relayer,
    );
    s = await db.settlement.update({ where: { orderId }, data: { solanaTx: sig } });
  }

  // Bankroll credit: confidential escrow → user. Skipped when nothing was escrowed or payout is 0.
  if (!s.escrowPayTx && order.escrowTx && amount > 0n) {
    const { escrow, topUpTx } = await ensureEscrowLiquidity(amount);
    if (topUpTx)
      s = await db.settlement.update({ where: { orderId }, data: { escrowTopUpTx: topUpTx } });
    const sigs = await confidentialTransfer(escrow, keys.owner.address, amount);
    s = await db.settlement.update({
      where: { orderId },
      data: { escrowPayTx: sigs.at(-1) ?? null },
    });
  }

  // Tempo: credit the stake authorization back with a memo receipt (Flow A step 7).
  if (!s.tempoPayoutTx && order.tempoStakeTx) {
    const { txHash, memo } = await payout(db, {
      settlementId: orderId,
      to: order.user.tempoAddress as Address,
      amount: stake,
    });
    s = await db.settlement.update({
      where: { orderId },
      data: { tempoPayoutTx: txHash, memoHash: memo },
    });
  }

  const status = s.outcome === 'refunded' ? 'refunded' : 'settled';
  await db.order.update({ where: { id: orderId }, data: { step: 'settled', status } });
  emit({
    type: 'settlement',
    userId: order.userId,
    orderId,
    outcome: s.outcome,
    payoutUsd: Number(s.payoutUsd),
  });
  return s;
}

/** Compensation: return the full stake on every leg that moved. */
export async function refundOrder(db: PrismaClient, orderId: string, reason: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  await db.order.update({ where: { id: orderId }, data: { error: reason } });
  return finalize(db, orderId, { label: 'refunded', payout: units(Number(order.stakeUsd ?? 0)) });
}

/**
 * Settle a filled bet. Returns null when a close-at-mark could not unwind every contract yet
 * (book too thin, or the remainder is under HL's $10 minimum) — the caller retries later or
 * waits for resolution; nothing is ever written off.
 */
export async function settleOrder(
  db: PrismaClient,
  exec: Executor,
  orderId: string,
  r: Resolution,
) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { settlement: true },
  });
  if (order.settlement) return finalize(db, orderId, { label: 'closed', payout: 0n }); // resume
  if (order.step !== 'executed') throw new Error(`order ${orderId} is at step ${order.step}`);

  const side: OutcomeSide = order.side === 'yes' ? 0 : 1;
  const filled = Number(order.filledSize);
  const stake = units(Number(order.stakeUsd ?? 0));
  const entryCost = units(filled * Number(order.avgPx ?? 0) + Number(order.builderFee ?? 0));
  const unspent = stake > entryCost ? stake - entryCost : 0n;
  const closes = () => db.order.findMany({ where: { parentId: orderId } });
  const sold = async () => (await closes()).reduce((t, c) => t + Number(c.filledSize), 0);

  if (r.kind === 'resolved') {
    // Contracts already sold by an earlier partial close don't pay out at resolution.
    const held = filled - (await sold());
    const proceeds = units(r.winner === side ? held : 0) + closeProceeds(await closes());
    return finalize(db, orderId, {
      label: r.winner === 0 ? 'yes' : 'no',
      payout: proceeds + unspent,
    });
  }

  // Close at mark: IOC sells into the bid book, in rounds against a fresh book. HL sells are real
  // (or paper) executor orders; other venues sell through their adapter.
  const hl = isHl(order.marketId);
  const { venue, nativeId } = parseMarketId(order.marketId);
  const bestBid = async () =>
    hl
      ? Number((await bookFor(hlOutcome(order.marketId), side)).levels[0][0]?.px ?? NaN)
      : ((
          await venues()
            .venue(venue)
            .book(nativeId, order.side as 'yes' | 'no')
        ).bids[0]?.px ?? NaN);
  let last: string | undefined;
  for (let round = 0; round < CLOSE_ROUNDS; round++) {
    const remaining = filled - (await sold());
    if (remaining <= 1e-9) break;
    const bid = await bestBid();
    if (Number.isNaN(bid)) break;
    const limitPx = Math.max(0.001, Number((bid * (1 - CLOSE_SLIPPAGE)).toFixed(4)));
    const close = hl
      ? await placeOrder(
          db,
          exec,
          order.userId,
          {
            outcome: hlOutcome(order.marketId),
            side,
            isBuy: false,
            sz: remaining,
            limitPx,
            tif: 'Ioc',
          },
          { parentId: orderId },
        )
      : await placeVenueOrder(
          db,
          order.userId,
          {
            marketId: order.marketId,
            side: order.side as 'yes' | 'no',
            sz: remaining,
            limitPx,
            isBuy: false,
          },
          { parentId: orderId },
        );
    last = close.id;
    if (close.status === 'rejected' || Number(close.filledSize) === 0) break;
  }
  if (filled - (await sold()) > 1e-9) return null;
  const payout = closeProceeds(await closes()) + unspent;
  return finalize(db, orderId, {
    label: 'closed',
    payout,
    ...(last ? { closeOrderId: last } : {}),
  });
}

function closeProceeds(closes: { filledSize: unknown; avgPx: unknown; builderFee: unknown }[]) {
  const usd = closes.reduce(
    (t, c) => t + Number(c.filledSize) * Number(c.avgPx ?? 0) - Number(c.builderFee ?? 0),
    0,
  );
  return usd > 0 ? units(usd) : 0n;
}
