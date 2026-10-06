import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { createExecutor, type Executor } from '@tyr/hyperliquid';
import type { PrismaClient } from '@tyr/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { adminRoutes } from './routes/admin.js';
import { agentRoutes } from './routes/agent.js';
import { authRoutes } from './routes/auth.js';
import { balanceRoutes, betRoutes } from './routes/bets.js';
import { depositRoutes } from './routes/deposits.js';
import { hedgeRoutes } from './routes/hedge.js';
import { limitRoutes } from './routes/limits.js';
import { marketRoutes } from './routes/markets.js';
import { receiptRoutes } from './routes/receipts.js';
import { sponsorRoutes } from './routes/sponsor.js';
import { wsRoutes } from './routes/ws.js';
import { zcashRoutes } from './routes/zcash.js';

export type AppDeps = {
  db: PrismaClient;
  cookieSecret: string;
  logger?: boolean;
  executor?: Executor;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(cookie, { secret: deps.cookieSecret });
  await app.register(websocket);
  app.decorate('db', deps.db);
  app.get('/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(sponsorRoutes, { prefix: '/api/tempo' });
  await app.register(limitRoutes, { prefix: '/api/limits' });
  await app.register(marketRoutes, { prefix: '/api/markets' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  const executor = deps.executor ?? createExecutor();
  await app.register(betRoutes(executor), { prefix: '/api/bets' });
  await app.register(agentRoutes(executor), { prefix: '/api/agent' });
  await app.register(balanceRoutes, { prefix: '/api/balance' });
  await app.register(depositRoutes, { prefix: '/api/deposits' });
  await app.register(zcashRoutes, { prefix: '/api/zcash' });
  await app.register(hedgeRoutes, { prefix: '/api/hedge' });
  await app.register(receiptRoutes, { prefix: '/api/receipts' });
  await app.register(wsRoutes);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
  }
}
