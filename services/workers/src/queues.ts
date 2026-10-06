// BullMQ wiring for the settlement tick: a repeatable job on Redis, concurrency 1, so ticks never
// overlap across worker processes and a crashed tick is retried by the queue.
import { Queue, Worker } from 'bullmq';
import type { PrismaClient } from '@tyr/db';
import type { Executor } from '@tyr/hyperliquid';
import { settlementWorker } from '@tyr/pipeline';
import { fundingWorker } from '@tyr/evm-deposits';
import { zcashWorker } from '@tyr/zcash';

export const SETTLEMENT_QUEUE = 'settlement';
export const FUNDING_QUEUE = 'funding';
export const ZCASH_QUEUE = 'zcash';

const connection = (redisUrl: string) => {
  const u = new URL(redisUrl);
  return { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null };
};

export async function startSettlement(
  db: PrismaClient,
  exec: Executor,
  opts: { redisUrl: string; everyMs: number; queueName?: string },
) {
  const name = opts.queueName ?? SETTLEMENT_QUEUE;
  const tick = settlementWorker(db, exec);
  const queue = new Queue(name, { connection: connection(opts.redisUrl) });
  await queue.upsertJobScheduler('tick', { every: opts.everyMs }, { name: 'tick' });
  const worker = new Worker(name, async () => ({ settled: await tick() }), {
    connection: connection(opts.redisUrl),
    concurrency: 1,
  });
  return {
    queue,
    worker,
    close: async () => {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    },
  };
}

/** PRD 6.2 funding router: repeatable scan + credit tick, concurrency 1 (no double mints). */
export async function startFunding(
  db: PrismaClient,
  opts: { redisUrl: string; everyMs: number; queueName?: string },
) {
  const name = opts.queueName ?? FUNDING_QUEUE;
  const tick = fundingWorker(db);
  const queue = new Queue(name, { connection: connection(opts.redisUrl) });
  await queue.upsertJobScheduler('tick', { every: opts.everyMs }, { name: 'tick' });
  const worker = new Worker(name, () => tick(), {
    connection: connection(opts.redisUrl),
    concurrency: 1,
  });
  return {
    queue,
    worker,
    close: async () => {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    },
  };
}

/** PRD 7.4/7.6 Flow B: scan shielded memo orders → place → FROST-authorized ZEC payouts. */
export async function startZcash(
  db: PrismaClient,
  exec: Executor,
  opts: { redisUrl: string; everyMs: number; queueName?: string },
) {
  const name = opts.queueName ?? ZCASH_QUEUE;
  const tick = zcashWorker(db, exec);
  const queue = new Queue(name, { connection: connection(opts.redisUrl) });
  await queue.upsertJobScheduler('tick', { every: opts.everyMs }, { name: 'tick' });
  const worker = new Worker(name, () => tick(), {
    connection: connection(opts.redisUrl),
    concurrency: 1,
  });
  return {
    queue,
    worker,
    close: async () => {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    },
  };
}
