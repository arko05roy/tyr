import { config as loadDotenv } from 'dotenv';
import Fastify from 'fastify';
import { assertTestnets, loadConfigOrExit } from '@tyr/core';

loadDotenv({ path: new URL('../../../.env', import.meta.url) });
const cfg = loadConfigOrExit();

try {
  const checks = await assertTestnets(cfg);
  for (const c of checks) console.log(`testnet ✓ ${c.name}: ${c.detail}`);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const app = Fastify({ logger: true });
app.get('/health', async () => ({ ok: true }));
await app.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' });
