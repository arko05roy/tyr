// PRD 4.2 — resting limit far from mid → cancel → canceled.
import { afterAll, describe, expect, it } from 'vitest';
import { cancelOrder, createExecutor, placeOrder } from '../src/index.js';
import { db, firstFeatured, registerUser } from './helpers.js';

const exec = createExecutor();
afterAll(() => db.$disconnect());

describe(`hl.cancel (live testnet, ${exec.mode})`, () => {
  it('rests a far bid, then cancels it', async () => {
    const { user } = await registerUser();
    const m = await firstFeatured();
    expect(m.yes.bid).toBeGreaterThan(0.01); // 0.01 is genuinely far from this book
    const order = await placeOrder(db, exec, user.id, {
      outcome: m.outcome,
      side: 0,
      isBuy: true,
      sz: 1000,
      limitPx: 0.01,
      tif: 'Gtc',
    });
    expect(order.status).toBe('resting');
    expect(Number(order.filledSize)).toBe(0);

    const canceled = await cancelOrder(db, exec, order.id);
    expect(canceled.status).toBe('canceled');
    await expect(cancelOrder(db, exec, order.id)).rejects.toThrow(/not resting/);
  });
});
