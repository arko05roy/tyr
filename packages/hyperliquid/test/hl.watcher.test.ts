// PRD 4.4 — resolution watcher against live outcomeMeta.
import { describe, expect, it } from 'vitest';
import { ResolutionWatcher, outcomeMeta, resolvesAt } from '../src/index.js';
import { firstFeatured, must } from './helpers.js';

describe('hl.watcher (live testnet)', () => {
  it('flags a past-deadline listed outcome as expired, once; leaves live ones alone', async () => {
    const { outcomes } = await outcomeMeta();
    const stale = must(
      outcomes.find((o) => (resolvesAt(o.description)?.getTime() ?? Infinity) < Date.now()),
      'past-deadline outcome',
    );
    const live = await firstFeatured();

    const w = new ResolutionWatcher(() => [stale.outcome, live.outcome]);
    const first = await w.tick();
    expect(first).toEqual([expect.objectContaining({ kind: 'expired', outcome: stale.outcome })]);
    expect(await w.tick()).toEqual([]); // idempotent
  });
});
