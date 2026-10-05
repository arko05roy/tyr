// PRD 5.2/5.3 — settlement and compensation for Flow A orders.
//   payout = proceeds + (stake − entry cost − entry builder fee)
//   resolved: proceeds = filled contracts × 1 if the bet's side won, else 0
//   closed:   proceeds = real close order (IOC sell into the live bid book) − its builder fee
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
import type { Address } from 'viem';
import { confidentialAccount, ensureEscrowLiquidity } from './accounts.js';
import { emit } from './events.js';
import { OUTCOME, commit, fromUnits, units } from './market.js';

export type Resolution = { kind: 'resolved'; winner: OutcomeSide } | { kind: 'close' };

const CLOSE_SLIPPAGE = 0.1;

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
          marketId: BigInt(order.hlMarket),
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
    const escrow = await ensureEscrowLiquidity(amount);
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

  if (r.kind === 'resolved') {
    const proceeds = r.winner === side ? units(filled) : 0n;
    return finalize(db, orderId, {
      label: r.winner === 0 ? 'yes' : 'no',
      payout: proceeds + unspent,
    });
  }

  // Close at mark: a real IOC sell of the filled contracts into the live bid book.
  const bid = (await bookFor(Number(order.hlMarket), side)).levels[0][0];
  if (!bid) throw new Error(`no bids to close ${orderId} against`);
  const close = await placeOrder(db, exec, order.userId, {
    outcome: Number(order.hlMarket),
    side,
    isBuy: false,
    sz: filled,
    limitPx: Math.max(0.001, Number((Number(bid.px) * (1 - CLOSE_SLIPPAGE)).toFixed(4))),
    tif: 'Ioc',
  });
  // Contracts the book could not absorb within the slippage bound are valued at 0 (disclosed).
  const proceedsUsd =
    Number(close.filledSize) * Number(close.avgPx ?? 0) - Number(close.builderFee ?? 0);
  const proceeds = proceedsUsd > 0 ? units(proceedsUsd) : 0n;
  return finalize(db, orderId, {
    label: 'closed',
    payout: proceeds + unspent,
    closeOrderId: close.id,
  });
}
