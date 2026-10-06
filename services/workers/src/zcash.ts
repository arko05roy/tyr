// PRD 7.4/7.6 worker process: BullMQ repeatable Flow B tick (needs the tyr zcash-sidecar running).
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@tyr/db';
import { createExecutor } from '@tyr/hyperliquid';
import { startZcash } from './queues.js';

loadDotenv({ path: new URL('../../../.env', import.meta.url) });
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL missing');
const exec = createExecutor();
const everyMs = Number(process.env.ZCASH_INTERVAL_MS ?? 10_000);
const { worker } = await startZcash(new PrismaClient(), exec, { redisUrl, everyMs });

worker.on('completed', (_job, r: { seen: string[]; placed: string[]; paid: string[] }) => {
  if (r.seen.length || r.placed.length || r.paid.length) console.log('zcash', r);
});
worker.on('failed', (_job, err) => console.error('zcash tick failed', err.message));
console.log(`zcash worker (${exec.mode}) on BullMQ every ${everyMs}ms`);
