// PRD 9.4 — simulated swap leg (owner-approved deviation): quotes at the live oracle with the
// disclosed 30bp fee + 20bp slippage haircut; value math for both directions; `sell` hedges are
// capped by the hot wallet's real on-chain inventory.
import { describe, expect, it } from 'vitest';
import {
  POOL_FEE_BPS,
  SLIPPAGE_BPS,
  hedgeValue,
  sharesFor,
  stockPrice,
  walletShares,
} from '../src/index.js';

const h = 1 - (POOL_FEE_BPS + SLIPPAGE_BPS) / 10_000;

describe('simulated Stock Token swap (live price + RH testnet inventory)', () => {
  it('quotes shares at the live oracle less fee + slippage', async () => {
    const p = await stockPrice('AMZN');
    const shares = sharesFor(25, p.px);
    expect(shares).toBeCloseTo((25 / p.px) * h, 12);
    expect(shares).toBeLessThan(await walletShares('AMZN')); // a $25 short is covered
  });

  it('values buy and sell hedges symmetrically around entry', () => {
    const shares = sharesFor(100, 100); // 0.995 sh
    const flat = { shares, entryPx: 100, exitPx: 100 };
    expect(hedgeValue({ ...flat, direction: 'buy' })).toBeCloseTo(100 * h * h, 9);
    expect(hedgeValue({ ...flat, direction: 'sell' })).toBeCloseTo(100 * h * h, 9);
    expect(hedgeValue({ ...flat, exitPx: 110, direction: 'buy' })).toBeGreaterThan(100 * h * h);
    expect(hedgeValue({ ...flat, exitPx: 110, direction: 'sell' })).toBeLessThan(100 * h * h);
    expect(hedgeValue({ ...flat, exitPx: 300, direction: 'sell' })).toBe(0); // floored, never negative
  });
});
