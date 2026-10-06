// PRD 4.3 (Stop 4 decision: pooled float). One HL float account trades for everyone; each tyr
// user's exposure lives in the Order table. Funding is matched 1:1 by the Solana confidential
// debit in Phase 5 — this module only owns execution + bookkeeping.
import type { PrismaClient } from '@tyr/db';
import type { OutcomeSide } from './assets.js';
import type { ExecResult, Executor, OrderRequest } from './executor.js';

const SIDE = ['yes', 'no'] as const;

const resultFields = (r: ExecResult) => ({
  hlOid: r.oid !== undefined ? BigInt(r.oid) : null,
  filledSize: r.filledSz,
  avgPx: r.filledSz ? r.avgPx : null,
  builderFee: r.builderFeeUsd,
  status: r.status,
  simulated: r.simulated,
  execution: r as unknown as object,
});

const requestFields = (req: OrderRequest) => ({
  hlMarket: String(req.outcome),
  marketId: `hyperliquid:${req.outcome}`,
  side: SIDE[req.side],
  isBuy: req.isBuy,
  tif: req.tif,
  size: req.sz,
  price: req.limitPx,
});

export async function placeOrder(
  db: PrismaClient,
  exec: Executor,
  userId: string,
  req: OrderRequest,
  link: { parentId?: string } = {},
) {
  const r = await exec.place(req);
  return db.order.create({
    data: { userId, ...requestFields(req), ...resultFields(r), parentId: link.parentId ?? null },
  });
}

/** Execute an already-persisted `pending` Order (Flow A saga creates the row before any chain write). */
export async function executeOrder(
  db: PrismaClient,
  exec: Executor,
  orderId: string,
  req: OrderRequest,
) {
  const r = await exec.place(req);
  return db.order.update({
    where: { id: orderId },
    data: { ...requestFields(req), ...resultFields(r) },
  });
}

export async function cancelOrder(db: PrismaClient, exec: Executor, orderId: string) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (o.status !== 'resting') throw new Error(`order ${orderId} is ${o.status}, not resting`);
  if (o.simulated !== (exec.mode === 'paper'))
    throw new Error(`order ${orderId} was placed in the other execution mode`);
  const { ok } = await exec.cancel({
    outcome: Number(o.hlMarket),
    side: o.side === 'yes' ? 0 : 1,
    oid: o.hlOid !== null ? Number(o.hlOid) : undefined,
  });
  if (!ok) throw new Error(`HL did not confirm cancel for ${orderId}`);
  return db.order.update({ where: { id: orderId }, data: { status: 'canceled' } });
}

/** Net filled size per (outcome, side) for a user — their share of the pooled float. */
export async function positions(db: PrismaClient, userId: string) {
  const orders = await db.order.findMany({
    where: { userId, filledSize: { gt: 0 }, hlMarket: { not: null } },
  });
  const pos = new Map<string, { outcome: number; side: OutcomeSide; size: number; cost: number }>();
  for (const o of orders) {
    const key = `${o.hlMarket}:${o.side}`;
    const p = pos.get(key) ?? {
      outcome: Number(o.hlMarket),
      side: o.side === 'yes' ? 0 : 1,
      size: 0,
      cost: 0,
    };
    const sz = Number(o.filledSize) * (o.isBuy ? 1 : -1);
    p.size += sz;
    p.cost += sz * Number(o.avgPx ?? 0);
    pos.set(key, p);
  }
  return [...pos.values()].filter((p) => Math.abs(p.size) > 1e-9);
}

export type { ExecResult };
