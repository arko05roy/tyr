import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@tyr/db';
import { assertTestnets, loadConfigOrExit } from '@tyr/core';
import { buildApp } from './app.js';

loadDotenv({ path: new URL('../../../.env', import.meta.url) });
const cfg = loadConfigOrExit();

try {
  const checks = await assertTestnets(cfg);
  for (const c of checks) console.log(`testnet ✓ ${c.name}: ${c.detail}`);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const secret = process.env.TYR_SECRETS_KEY;
if (!secret) {
  console.error('TYR_SECRETS_KEY missing');
  process.exit(1);
}
const app = await buildApp({ db: new PrismaClient(), cookieSecret: secret, logger: true });
await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });
