// PRD 5.2 settlement tick: watch every market with open bets.
//   resolved (winner known) → settle by outcome
//   expired                 → close at mark; if not fully unwound, retry every tick until it is
//                             or the market resolves
// Phase 11b: HL markets are watched by ResolutionWatcher. Other venues have no resolution feed yet
// (simulated adapters), so their bets close at mark once the market passes resolvesAt.
import type { PrismaClient } from '@tyr/db';
import { ResolutionWatcher, type Executor } from '@tyr/hyperliquid';
import { parseMarketId } from '@tyr/venues';
import { settleOrder } from './settle.js';
import { venues } from './venue.js';

export function settlementWorker(db: PrismaClient, exec: Executor, log = console) {
  const openOrders = () =>
    db.order.findMany({ where: { step: 'executed', settlement: null, filledSize: { gt: 0 } } });
  const watcher = new ResolutionWatcher(async () => [
    ...new Set(
      (await openOrders()).filter((o) => o.hlMarket !== null).map((o) => Number(o.hlMarket)),
    ),
  ]);
  const closing = new Set<number>(); // expired markets still being unwound

  async function venueExpired(marketId: string) {
    const { venue, nativeId } = parseMarketId(marketId);
    const m = await venues().venue(venue).market(nativeId);
    return !m || m.resolvesAt <= new Date().toISOString();
  }

  return async function tick() {
    const settled: string[] = [];
    const resolved = new Map<number, 0 | 1>();
    for (const e of await watcher.tick()) {
      if (e.kind === 'expired') closing.add(e.outcome);
      else if (e.winner !== null) resolved.set(e.outcome, e.winner);
      else log.error(`outcome ${e.outcome} delisted without a pinned price — needs operator`);
    }
    for (const o of await openOrders()) {
      if (o.hlMarket === null) {
        if (
          (await venueExpired(o.marketId)) &&
          (await settleOrder(db, exec, o.id, { kind: 'close' }))
        )
          settled.push(o.id);
        continue;
      }
      const outcome = Number(o.hlMarket);
      const winner = resolved.get(outcome);
      if (winner !== undefined) {
        await settleOrder(db, exec, o.id, { kind: 'resolved', winner });
        settled.push(o.id);
      } else if (closing.has(outcome)) {
        if (await settleOrder(db, exec, o.id, { kind: 'close' })) settled.push(o.id);
      }
    }
    for (const id of resolved.keys()) closing.delete(id);
    return settled;
  };
}
