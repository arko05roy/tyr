// Offline: simulated venues only (fixed clock), so the matching and routing math is deterministic.
import { describe, expect, it } from 'vitest';
import {
  VenueRegistry,
  groupEvents,
  routeOrder,
  executeRoute,
  simulatedVenues,
  solanaMarketId,
  PROFILES,
} from '../src/index.js';

const now = () => Date.UTC(2026, 9, 6, 12);
const reg = new VenueRegistry(simulatedVenues(undefined, now));

describe('venues (simulated)', () => {
  it('normalizes every venue into one market shape with sane books', async () => {
    const { markets, errors } = await reg.markets();
    expect(errors).toEqual([]);
    expect(new Set(markets.map((m) => m.venue))).toEqual(
      new Set(['polymarket', 'kalshi', 'limitless']),
    );
    for (const m of markets) {
      expect(m.id).toBe(`${m.venue}:${m.nativeId}`);
      expect(m.yes.bid).toBeLessThan(m.yes.ask);
      expect(m.yes.ask).toBeLessThan(1);
    }
  });

  it('NO book mirrors YES', async () => {
    const yes = await reg.venue('kalshi').book('KXfed-oct-cut25', 'yes');
    const no = await reg.venue('kalshi').book('KXfed-oct-cut25', 'no');
    expect(no.asks[0]?.px).toBeCloseTo(1 - (yes.bids[0]?.px ?? 0), 6);
  });

  it('groups the same question across venues', async () => {
    const events = groupEvents((await reg.markets()).markets);
    const fed = events.find((e) => e.eventKey === 'fed:fomc-oct:cut25');
    expect(fed?.venues.map((v) => v.venue).sort()).toEqual(['kalshi', 'limitless', 'polymarket']);
    expect(fed?.priceGap).toBeGreaterThan(0);
  });

  it('routes at least as well as the best single venue', async () => {
    const route = await routeOrder(reg, {
      eventKey: 'fed:fomc-oct:cut25',
      side: 'yes',
      stakeUsd: 50_000,
    });
    expect(route.costUsd).toBeLessThanOrEqual(50_000 + 1e-6);
    expect(route.contracts).toBeGreaterThanOrEqual(route.singles[0]?.contracts ?? 0);
    expect(route.edgeVsWorst).toBeGreaterThan(0);
    const fills = await executeRoute(reg, route);
    expect(fills.every((f) => f.simulated && f.status === 'filled')).toBe(true);
  });

  it('applies Kalshi fee formula', () => {
    expect(PROFILES.kalshi.fee(0.5, 100)).toBe(1.75);
  });

  it('keeps HL market ids and hashes others above them', () => {
    expect(solanaMarketId('hyperliquid:42')).toBe(42n);
    expect(solanaMarketId('kalshi:KXfed-oct-cut25') >= 1n << 63n).toBe(true);
  });

  it('closes a position by selling into the bids (below the venue minimum too)', async () => {
    const v = reg.venue('polymarket');
    const book = await v.book('fed-oct-cut25', 'no');
    const best = book.bids[0]?.px ?? 0;
    const f = await v.execute({
      marketId: 'polymarket:fed-oct-cut25',
      side: 'no',
      sz: 3,
      limitPx: best * 0.9,
      isBuy: false,
    });
    expect(f.status).toBe('filled');
    expect(f.avgPx).toBeCloseTo(best, 6);
    const none = await v.execute({
      marketId: 'polymarket:fed-oct-cut25',
      side: 'no',
      sz: 3,
      limitPx: best + 0.01,
      isBuy: false,
    });
    expect(none.status).toBe('canceled');
  });
});
