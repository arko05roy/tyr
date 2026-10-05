import cookie from '@fastify/cookie';
import type { PrismaClient } from '@tyr/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { limitRoutes } from './routes/limits.js';
import { marketRoutes } from './routes/markets.js';
import { sponsorRoutes } from './routes/sponsor.js';

export type AppDeps = { db: PrismaClient; cookieSecret: string; logger?: boolean };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(cookie, { secret: deps.cookieSecret });
  app.decorate('db', deps.db);
  app.get('/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(sponsorRoutes, { prefix: '/api/tempo' });
  await app.register(limitRoutes, { prefix: '/api/limits' });
  await app.register(marketRoutes, { prefix: '/api/markets' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
  }
}
