// PRD 5.2 worker: poll HL testnet for resolutions/expiries of markets with open bets and settle.
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@tyr/db';
import { createExecutor } from '@tyr/hyperliquid';
import { settlementWorker } from '@tyr/pipeline';

loadDotenv({ path: new URL('../../../.env', import.meta.url) });
const db = new PrismaClient();
const exec = createExecutor();
const tick = settlementWorker(db, exec);
const INTERVAL_MS = Number(process.env.SETTLEMENT_INTERVAL_MS ?? 30_000);

console.log(`settlement worker (${exec.mode}) every ${INTERVAL_MS}ms`);
for (;;) {
  try {
    const settled = await tick();
    if (settled.length) console.log('settled', settled);
  } catch (err) {
    console.error('settlement tick failed', (err as Error).message);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
