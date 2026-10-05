// PRD 4.4: fill + resolution watcher.
// HL has no explicit "resolved" flag: an outcome stays in outcomeMeta until its deployer calls
// settleOutcome, after which it disappears. We therefore report:
//   resolved — outcome left outcomeMeta; winner = side whose last observed mid was pinned ≥ 0.99
//   expired  — past its deadline but still listed (Phase 5 closes at mark with a real order)
import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid';
import { outcomeCoin, resolvesAt, type OutcomeSide } from './assets.js';
import { allMids, outcomeMeta } from './info.js';

export type ResolutionEvent =
  | { kind: 'resolved'; outcome: number; winner: OutcomeSide | null; lastYesMid: number | null }
  | { kind: 'expired'; outcome: number; resolvesAt: string; yesMid: number | null };

/** Stateful poller: call `tick()` on an interval (BullMQ repeatable job in services/workers). */
export class ResolutionWatcher {
  private lastMid = new Map<number, number>();
  private announced = new Set<string>();

  constructor(private readonly watched: () => Promise<number[]> | number[]) {}

  async tick(now = new Date()): Promise<ResolutionEvent[]> {
    const ids = await this.watched();
    const [{ outcomes }, mids] = await Promise.all([outcomeMeta(), allMids()]);
    const listed = new Map(outcomes.map((o) => [o.outcome, o]));
    const events: ResolutionEvent[] = [];
    const emit = (e: ResolutionEvent) => {
      const k = `${e.kind}:${e.outcome}`;
      if (!this.announced.has(k)) {
        this.announced.add(k);
        events.push(e);
      }
    };
    for (const id of ids) {
      const mid = mids[outcomeCoin(id, 0)];
      if (mid !== undefined) this.lastMid.set(id, Number(mid));
      const o = listed.get(id);
      if (!o) {
        const last = this.lastMid.get(id) ?? null;
        const winner = last === null ? null : last >= 0.99 ? 0 : last <= 0.01 ? 1 : null;
        emit({ kind: 'resolved', outcome: id, winner, lastYesMid: last });
        continue;
      }
      const at = resolvesAt(o.description);
      if (at && at <= now)
        emit({
          kind: 'expired',
          outcome: id,
          resolvesAt: at.toISOString(),
          yesMid: mid ? Number(mid) : null,
        });
    }
    return events;
  }
}

/** Live mode only: stream the float's fills + order updates from HL testnet WS. */
export async function subscribeFloat(
  user: `0x${string}`,
  on: { fill?: (f: unknown) => void; order?: (o: unknown) => void },
) {
  const transport = new WebSocketTransport({ isTestnet: true });
  const client = new SubscriptionClient({ transport });
  const { fill, order } = on;
  const subs = await Promise.all([
    fill ? client.userFills({ user }, (e) => e.fills.forEach(fill)) : null,
    order ? client.orderUpdates({ user }, (e) => e.forEach(order)) : null,
  ]);
  return async () => {
    await Promise.all(subs.map((s) => s?.unsubscribe()));
    await transport.close();
  };
}
