// PRD 5.2 settlement worker tick: watch every market with open orders; resolved → settle by
// outcome, expired-but-unsettled → close at mark with a real order.
import type { PrismaClient } from '@tyr/db';
import { ResolutionWatcher, type Executor } from '@tyr/hyperliquid';
import { settleOrder } from './settle.js';

export function settlementWorker(db: PrismaClient, exec: Executor) {
  const openOrders = () =>
    db.order.findMany({ where: { step: 'executed', settlement: null, filledSize: { gt: 0 } } });
  const watcher = new ResolutionWatcher(async () => [
    ...new Set((await openOrders()).map((o) => Number(o.hlMarket))),
  ]);

  return async function tick() {
    const events = await watcher.tick();
    const settled: string[] = [];
    for (const e of events) {
      const orders = (await openOrders()).filter((o) => Number(o.hlMarket) === e.outcome);
      for (const o of orders) {
        if (e.kind === 'resolved' && e.winner !== null)
          await settleOrder(db, exec, o.id, { kind: 'resolved', winner: e.winner });
        else await settleOrder(db, exec, o.id, { kind: 'close' });
        settled.push(o.id);
      }
    }
    return settled;
  };
}
