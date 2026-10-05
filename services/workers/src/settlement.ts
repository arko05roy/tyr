// PRD 5.2 worker process: BullMQ repeatable settlement tick against HL testnet.
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@tyr/db';
import { createExecutor } from '@tyr/hyperliquid';
import { startSettlement } from './queues.js';

loadDotenv({ path: new URL('../../../.env', import.meta.url) });
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL missing');
const exec = createExecutor();
const everyMs = Number(process.env.SETTLEMENT_INTERVAL_MS ?? 30_000);
const { worker } = await startSettlement(new PrismaClient(), exec, { redisUrl, everyMs });

worker.on('completed', (_job, r: { settled: string[] }) => {
  if (r.settled.length) console.log('settled', r.settled);
});
worker.on('failed', (_job, err) => console.error('settlement tick failed', err.message));
console.log(`settlement worker (${exec.mode}) on BullMQ every ${everyMs}ms`);
