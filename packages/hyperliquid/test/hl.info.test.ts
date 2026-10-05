// PRD 4.1 — live HL testnet info endpoints.
import { describe, expect, it } from 'vitest';
import { must } from './helpers.js';
import { featuredMarkets, market, meta, outcomeAssetId, spotMeta } from '../src/index.js';

describe('hl.info (live testnet)', () => {
  it('reads perp + spot meta', async () => {
    expect((await meta()).universe.length).toBeGreaterThan(0);
    expect((await spotMeta()).tokens.length).toBeGreaterThan(0);
  });

  it('featured markets are unresolved with non-empty two-sided books', async () => {
    const markets = await featuredMarkets();
    console.log(
      markets.map((m) => `#${m.outcome} ${m.yes.bid}/${m.yes.ask} → ${m.resolvesAt}`).join('\n'),
    );
    expect(markets.length).toBeGreaterThan(0);
    for (const m of markets) {
      expect(new Date(m.resolvesAt).getTime()).toBeGreaterThan(Date.now());
      expect(m.yes.bid).toBeGreaterThan(0);
      expect(m.yes.ask).toBeGreaterThan(m.yes.bid);
      expect(outcomeAssetId(m.outcome, 0)).toBe(100_000_000 + 10 * m.outcome);
    }
  });

  it('market detail returns YES and NO books', async () => {
    const m = must((await featuredMarkets())[0], 'featured market');
    const d = await market(m.outcome);
    expect(d?.books.yes.levels[0].length).toBeGreaterThan(0);
    expect(d?.books.no.coin).toBe(`#${10 * m.outcome + 1}`);
  });
});
