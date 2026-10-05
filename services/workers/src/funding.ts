// PRD 6.2 worker process: BullMQ repeatable funding-router tick (EVM USDC, Solana USDC, Tempo memo
// deposits → tyrUSD confidential credit on devnet).
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@tyr/db';
import { startFunding } from './queues.js';

loadDotenv({ path: new URL('../../../.env', import.meta.url) });
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL missing');
const everyMs = Number(process.env.FUNDING_INTERVAL_MS ?? 15_000);
const { worker } = await startFunding(new PrismaClient(), { redisUrl, everyMs });

worker.on('completed', (_job, r: { detected: string[]; credited: string[] }) => {
  if (r.detected.length || r.credited.length) console.log('funding', r);
});
worker.on('failed', (_job, err) => console.error('funding tick failed', err.message));
console.log(`funding worker on BullMQ every ${everyMs}ms`);
