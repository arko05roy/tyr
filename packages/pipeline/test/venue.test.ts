// Offline: venue-aware sizing and market id resolution (no chain, no DB).
import { describe, expect, it } from 'vitest';
import { PROFILES } from '@tyr/venues';
import { sizeForVenue } from '../src/bet.js';
import { hlOutcome, isHl, resolveMarketId } from '../src/venue.js';

describe('pipeline venue cutover', () => {
  it('resolves legacy HL outcome ids and venue market ids', () => {
    expect(resolveMarketId({ outcome: 4120 })).toBe('hyperliquid:4120');
    expect(resolveMarketId({ marketId: 'kalshi:KXfed-oct-cut25', outcome: 1 })).toBe(
      'kalshi:KXfed-oct-cut25',
    );
    expect(() => resolveMarketId({})).toThrow();
    expect(() => resolveMarketId({ marketId: 'nocolon' })).toThrow();
    expect(isHl('hyperliquid:7')).toBe(true);
    expect(hlOutcome('hyperliquid:7')).toBe(7);
    expect(isHl('limitless:x')).toBe(false);
  });

  it('sizes within the stake under a non-linear fee (Kalshi)', () => {
    const fee = PROFILES.kalshi.fee;
    for (const [stake, px] of [
      [25, 0.5],
      [100, 0.62],
      [11, 0.33],
    ] as const) {
      const sz = sizeForVenue(stake, px, fee);
      expect(sz * px + fee(px, sz)).toBeLessThanOrEqual(stake + 1e-9);
      expect((sz + 1) * px + fee(px, sz + 1)).toBeGreaterThan(stake);
    }
  });

  it('sizes with zero fee (Polymarket)', () => {
    expect(sizeForVenue(25, 0.5, PROFILES.polymarket.fee)).toBe(50);
  });
});
