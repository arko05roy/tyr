// PRD 4.2/4.5 — marketable IOC with tyr's builder code. In paper mode (owner-approved), the fill
// is computed against the live testnet ask book and must reproduce it exactly.
import { afterAll, describe, expect, it } from 'vitest';
import {
  LiveExecutor,
  builderCode,
  builderRevenue,
  createExecutor,
  l2Book,
  placeOrder,
  positions,
} from '../src/index.js';
import { db, firstFeatured, must, registerUser } from './helpers.js';

const exec = createExecutor();
afterAll(() => db.$disconnect());

describe(`hl.order (live testnet, ${exec.mode})`, () => {
  it('IOC fills with builderFee > 0 and lands in the ledger', async () => {
    if (exec.mode === 'live') await LiveExecutor.approveBuilderFee();
    const { user } = await registerUser();
    const m = await firstFeatured();
    const ask = must((await l2Book(m.yes.coin)).levels[1][0], 'best ask');
    // ≥ $10 notional (HL minimum), capped at the top level so it is fully marketable.
    const sz = Math.min(Number(ask.sz), Math.ceil(11 / Number(ask.px)));

    const order = await placeOrder(db, exec, user.id, {
      outcome: m.outcome,
      side: 0,
      isBuy: true,
      sz,
      limitPx: Number(ask.px),
      tif: 'Ioc',
    });
    console.log(JSON.stringify({ id: order.id, status: order.status, execution: order.execution }));

    expect(['filled', 'partial']).toContain(order.status);
    expect(Number(order.filledSize)).toBeGreaterThan(0);
    expect(Number(order.builderFee)).toBeGreaterThan(0);
    expect(order.simulated).toBe(exec.mode === 'paper');
    if (exec.mode === 'paper') {
      expect(order.hlOid).toBeNull(); // never fabricated
      const notional = Number(order.filledSize) * Number(order.avgPx);
      expect(Number(order.builderFee)).toBeCloseTo((notional * builderCode().f) / 100_000, 8);
    } else {
      expect(order.hlOid).not.toBeNull();
    }

    const pos = await positions(db, user.id);
    expect(pos).toEqual([expect.objectContaining({ outcome: m.outcome, side: 0 })]);

    const rev = await builderRevenue(db);
    const bucket = exec.mode === 'paper' ? rev.ledger.simulated : rev.ledger.live;
    expect(bucket.feesUsd).toBeGreaterThan(0);
  });
});
