// PRD 9.4 / 9.5 — Flow D: hedge a bet with a Robinhood Chain Stock Token.
//
// Money: the hedge is paid from the user's confidential bankroll (real CT transfer user → escrow on
// devnet) and its value is paid back (escrow → user) when the bet settles. The swap leg is
// SIMULATED (owner-approved 2026-10-05: no Uniswap pool/quoter on RH testnet): fills at the live
// HL testnet `xyz` mid less a 30bp pool fee + 20bp slippage, no RH tx is sent. Real on RH testnet:
// chain, Stock Token contracts, and the hot wallet's inventory (a `sell` must be covered by it).
//
//   buy : shares = in / entry × (1 − h);  value = shares × exit × (1 − h)
//   sell: shares = in / entry × (1 − h);  value = max(0, shares × (2·entry − exit) × (1 − h))
//         (synthetic short against hot-wallet inventory: in back plus entry − exit per share)
//
// On close, a combined receipt (bet payout + hedge P&L) is hashed and anchored on Tempo with a
// memo-tagged transferWithMemo to the user (memo = keccak256("receipt:<id>")).
import type { PrismaClient } from '@tyr/db';
import { market } from '@tyr/hyperliquid';
import {
  availableBalance,
  confidentialAccount,
  emit,
  ensureEscrowLiquidity,
  fromUnits,
  units,
} from '@tyr/pipeline';
import { confidentialTransfer, escrowKeys } from '@tyr/solana';
import { payout } from '@tyr/tempo';
import { keccak256, toHex, type Address } from 'viem';
import { canonicalJson } from '@tyr/core';
import { STOCK_TOKENS, walletShares, type StockSymbol } from './chain.js';
import { hedgeEligibility } from './geofence.js';
import { hedgeDirection, hedgeRule, type Direction } from './mapping.js';
import { stockPrice } from './price.js';

export const POOL_FEE_BPS = 30;
export const SLIPPAGE_BPS = 20;
const HAIRCUT = 1 - (POOL_FEE_BPS + SLIPPAGE_BPS) / 10_000;
export const MIN_HEDGE_USD = 1;

export class HedgeRejectedError extends Error {
  constructor(
    message: string,
    readonly code: 'region' | 'order' | 'market' | 'size' | 'balance' | 'inventory' | 'price',
  ) {
    super(message);
  }
}

export type HedgeQuote = {
  simulated: true;
  orderId: string;
  stock: StockSymbol;
  token: Address;
  direction: Direction;
  rule: string;
  amountInUsd: number;
  maxAmountInUsd: number;
  entryPx: number;
  shares: number;
  priceSource: string;
  priceAt: string;
  feeBps: number;
};

export const sharesFor = (amountInUsd: number, px: number) => (amountInUsd / px) * HAIRCUT;

export function hedgeValue(h: {
  direction: Direction;
  shares: number;
  entryPx: number;
  exitPx: number;
}) {
  const v =
    h.direction === 'buy'
      ? h.shares * h.exitPx * HAIRCUT
      : h.shares * (2 * h.entryPx - h.exitPx) * HAIRCUT;
  return Math.max(0, v);
}

async function ruleFor(outcome: number) {
  const m = await market(outcome);
  if (!m) throw new HedgeRejectedError(`market ${outcome} not found`, 'market');
  const rule = hedgeRule(m.outcome);
  if (!rule) throw new HedgeRejectedError(`no stock hedge mapped for market ${outcome}`, 'market');
  return rule;
}

/** Hedge quote for an open bet the user owns; amount defaults to the bet's stake. */
export async function quoteHedge(
  db: PrismaClient,
  userId: string,
  orderId: string,
  amountInUsd?: number,
): Promise<HedgeQuote> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const elig = hedgeEligibility(user.region);
  if (!elig.eligible) throw new HedgeRejectedError(elig.reason, 'region');

  const order = await db.order.findFirst({
    where: { id: orderId, userId },
    include: { settlement: true, hedge: true },
  });
  if (!order || order.parentId) throw new HedgeRejectedError('no such bet', 'order');
  if (order.hedge) throw new HedgeRejectedError('bet already hedged', 'order');
  if (order.settlement || order.step !== 'executed' || Number(order.filledSize) <= 0)
    throw new HedgeRejectedError('only open, filled bets can be hedged', 'order');

  const rule = await ruleFor(Number(order.hlMarket));
  const direction = hedgeDirection(rule, order.side as 'yes' | 'no');
  const maxAmountInUsd = Number(order.stakeUsd ?? 0);
  const amount = amountInUsd ?? maxAmountInUsd;
  if (amount < MIN_HEDGE_USD || amount > maxAmountInUsd)
    throw new HedgeRejectedError(
      `hedge must be between $${MIN_HEDGE_USD} and the bet's stake ($${maxAmountInUsd})`,
      'size',
    );

  let price;
  try {
    price = await stockPrice(rule.stock);
  } catch (e) {
    throw new HedgeRejectedError((e as Error).message, 'price');
  }
  return {
    simulated: true,
    orderId,
    stock: rule.stock,
    token: STOCK_TOKENS[rule.stock],
    direction,
    rule: rule.rule,
    amountInUsd: amount,
    maxAmountInUsd,
    entryPx: price.px,
    shares: sharesFor(amount, price.px),
    priceSource: price.source,
    priceAt: price.at.toISOString(),
    feeBps: POOL_FEE_BPS + SLIPPAGE_BPS,
  };
}

/** Open the hedge: real bankroll debit (CT user → escrow), simulated swap at a fresh price. */
export async function openHedge(
  db: PrismaClient,
  userId: string,
  orderId: string,
  amountInUsd?: number,
) {
  const q = await quoteHedge(db, userId, orderId, amountInUsd);
  if (q.direction === 'sell' && (await walletShares(q.stock)) < q.shares)
    throw new HedgeRejectedError(
      `hot wallet ${q.stock} inventory can't cover this short`,
      'inventory',
    );
  const keys = await confidentialAccount(db, userId);
  const amount = units(q.amountInUsd);
  if ((await availableBalance(keys)) < amount)
    throw new HedgeRejectedError('insufficient confidential balance', 'balance');

  // Row first (unique on orderId) so a concurrent second request can't debit twice.
  await db.hedge.create({
    data: {
      orderId,
      userId,
      symbol: q.stock,
      stockToken: q.token,
      direction: q.direction,
      amountIn: q.amountInUsd,
      amountOut: q.shares,
      entryPx: q.entryPx,
      priceSource: q.priceSource,
      priceAt: new Date(q.priceAt),
      status: 'opening',
    },
  });
  const sigs = await confidentialTransfer(keys, (await escrowKeys()).owner.address, amount);
  const h = await db.hedge.update({
    where: { orderId },
    data: { escrowTx: sigs.at(-1) ?? null, status: 'open' },
  });
  emit({ type: 'order', userId, orderId, step: 'hedged', status: 'open' });
  return h;
}

/**
 * Close a hedge once its bet has settled: price at a fresh mark, pay value escrow → user (real CT),
 * then write the combined bet + hedge receipt and anchor it on Tempo. Every write is persisted
 * before the next, so a retry resumes.
 */
export async function closeHedge(db: PrismaClient, orderId: string) {
  let h = await db.hedge.findUniqueOrThrow({
    where: { orderId },
    include: { order: { include: { settlement: true, user: true } } },
  });
  const s = h.order.settlement;
  if (!s) throw new Error(`bet ${orderId} has not settled yet`);
  if (h.status === 'opening') throw new Error(`hedge ${orderId} never finished opening`);
  const keys = await confidentialAccount(db, h.userId);

  if (!h.exitPx) {
    const p = await stockPrice(h.symbol as StockSymbol);
    const valueUsd = hedgeValue({
      direction: h.direction as Direction,
      shares: Number(h.amountOut),
      entryPx: Number(h.entryPx),
      exitPx: p.px,
    });
    h = await db.hedge.update({
      where: { orderId },
      data: { exitPx: p.px, valueUsd: fromUnits(units(valueUsd)) },
      include: { order: { include: { settlement: true, user: true } } },
    });
  }
  const value = units(Number(h.valueUsd));

  if (!h.payTx && value > 0n) {
    const { escrow, topUpTx } = await ensureEscrowLiquidity(value);
    if (topUpTx) await db.hedge.update({ where: { orderId }, data: { escrowTopUpTx: topUpTx } });
    const sigs = await confidentialTransfer(escrow, keys.owner.address, value);
    h = await db.hedge.update({
      where: { orderId },
      data: { payTx: sigs.at(-1) ?? null },
      include: { order: { include: { settlement: true, user: true } } },
    });
  }

  if (!h.receiptId) {
    const payload = combinedReceipt(h, s);
    const r = await db.receipt.create({
      data: {
        kind: 'bet+hedge',
        payloadHash: keccak256(toHex(canonicalJson(payload))),
        payload,
        userId: h.userId,
        subjectId: orderId,
        visibility: 'private',
      },
    });
    h = await db.hedge.update({
      where: { orderId },
      data: { receiptId: r.id },
      include: { order: { include: { settlement: true, user: true } } },
    });
  }

  if (!h.receiptTx && h.receiptId) {
    // Memo-tagged Tempo receipt: zero-value transferWithMemo to the user carrying the receipt memo.
    const { txHash, memo } = await payout(db, {
      settlementId: `receipt:${h.receiptId}`,
      to: h.order.user.tempoAddress as Address,
      amount: 0n,
    });
    await db.receipt.update({
      where: { id: h.receiptId },
      data: { proofRef: `tempo:${txHash}:${memo}` },
    });
    h = await db.hedge.update({
      where: { orderId },
      data: { receiptTx: txHash, status: 'closed', closedAt: new Date() },
      include: { order: { include: { settlement: true, user: true } } },
    });
    emit({ type: 'order', userId: h.userId, orderId, step: 'hedge-closed', status: 'closed' });
  }
  return h;
}

type HedgeRow = {
  orderId: string;
  symbol: string;
  stockToken: string;
  direction: string;
  amountIn: unknown;
  amountOut: unknown;
  entryPx: unknown;
  exitPx: unknown;
  valueUsd: unknown;
  escrowTx: string | null;
  payTx: string | null;
  priceSource: string;
  simulated: boolean;
};
type SettlementRow = {
  outcome: string;
  payoutUsd: unknown;
  pnl: unknown;
  solanaTx: string | null;
  escrowPayTx: string | null;
  tempoPayoutTx: string | null;
  memoHash: string | null;
};

/** The combined bet payout + hedge P&L record (PRD 9.5) — what the receipt hash commits to. */
export function combinedReceipt(h: HedgeRow, s: SettlementRow) {
  const hedgePnl = Number(h.valueUsd) - Number(h.amountIn);
  const betPnl = Number(s.pnl);
  return {
    kind: 'bet+hedge',
    orderId: h.orderId,
    bet: {
      outcome: s.outcome,
      payoutUsd: Number(s.payoutUsd),
      pnlUsd: betPnl,
      solanaSettleTx: s.solanaTx,
      solanaPayTx: s.escrowPayTx,
      tempoPayoutTx: s.tempoPayoutTx,
      tempoMemo: s.memoHash,
    },
    hedge: {
      chain: 'robinhood-testnet',
      stock: h.symbol,
      token: h.stockToken,
      direction: h.direction,
      amountInUsd: Number(h.amountIn),
      shares: Number(h.amountOut),
      entryPx: Number(h.entryPx),
      exitPx: Number(h.exitPx),
      valueUsd: Number(h.valueUsd),
      pnlUsd: Number(hedgePnl.toFixed(6)),
      solanaDebitTx: h.escrowTx,
      solanaPayTx: h.payTx,
      priceSource: h.priceSource,
      simulated: h.simulated,
    },
    netPnlUsd: Number((betPnl + hedgePnl).toFixed(6)),
  };
}

/** Worker tick: close every open hedge whose bet has settled. */
export function hedgeWorker(db: PrismaClient, log = console) {
  return async function tick() {
    const due = await db.hedge.findMany({
      where: { status: 'open', order: { settlement: { isNot: null } } },
    });
    const closed: string[] = [];
    for (const h of due) {
      try {
        await closeHedge(db, h.orderId);
        closed.push(h.orderId);
      } catch (e) {
        log.error(`hedge ${h.orderId} close failed: ${(e as Error).message}`);
      }
    }
    return closed;
  };
}
