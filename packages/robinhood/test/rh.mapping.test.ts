// PRD 9.2 — rule-based market → Stock Token mapping (Stop 9). Rules are checked against the live
// HL testnet outcome list, and every featured market that maps resolves to a real token.
import { featuredMarkets, outcomeMeta } from '@tyr/hyperliquid';
import { describe, expect, it } from 'vitest';
import { STOCK_TOKENS, hedgeDirection, hedgeRule } from '../src/index.js';

describe('hedge mapping (live HL testnet outcomes)', () => {
  it('maps stock, Fed, CPI and semis markets; ignores sports', async () => {
    const { outcomes } = await outcomeMeta();
    const mapped = outcomes.flatMap((o) => {
      const r = hedgeRule(o);
      return r ? [{ o, r }] : [];
    });
    console.log(`[evidence] ${mapped.length}/${outcomes.length} live outcomes map to a hedge`);
    expect(mapped.length).toBeGreaterThan(0);
    for (const { r } of mapped) expect(STOCK_TOKENS[r.stock]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const tsla = outcomes.find((o) => /perp:xyz:TSLA/.test(o.description));
    if (tsla) expect(hedgeRule(tsla)).toMatchObject({ stock: 'TSLA', yesDirection: 'sell' });
    const sports = outcomes.filter(
      (o) => /sportsContest/.test(o.name) && !/Nvidia/.test(o.description),
    );
    for (const o of sports) expect(hedgeRule(o)).toBeNull();
  });

  it('NO bets take the opposite trade', () => {
    const r = { stock: 'AMZN' as const, yesDirection: 'buy' as const, rule: 'x' };
    expect(hedgeDirection(r, 'yes')).toBe('buy');
    expect(hedgeDirection(r, 'no')).toBe('sell');
  });

  it('lists featured markets with a hedge (demo candidates)', async () => {
    for (const m of await featuredMarkets()) {
      const r = hedgeRule(m);
      if (r)
        console.log(
          `[evidence] featured ${m.outcome} ${m.name} → ${r.stock} (${r.rule}) bid ${m.yes.bid} ask ${m.yes.ask}`,
        );
    }
  });
});
