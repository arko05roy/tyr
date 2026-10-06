import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { createExecutor, type Executor } from '@tyr/hyperliquid';
import type { PrismaClient } from '@tyr/db';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import { createJsonSchemaTransformObject, jsonSchemaTransform } from 'fastify-type-provider-zod';
import { installContract, type ResponseCheck } from './contract.js';
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
import { components } from './schemas.js';
import { z } from 'zod';

export type AppDeps = {
  db: PrismaClient;
  cookieSecret: string;
  logger?: boolean;
  executor?: Executor;
  /** Response contract enforcement; defaults to 'strict' except in production. */
  responseCheck?: ResponseCheck;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  installContract(
    app,
    deps.responseCheck ?? (process.env.NODE_ENV === 'production' ? 'warn' : 'strict'),
  );
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'tyr.bet API',
        version: '1.0.0',
        description:
          'Testnet-only. Session auth = signed `tyr_session` cookie from the passkey routes. ' +
          'Agent routes are signed with the agent key (x-tyr-agent / x-tyr-timestamp / ' +
          'x-tyr-signature, EIP-191 over method, path, timestamp, sha256(body)); paid agent routes ' +
          'answer 402 with an MPP challenge. Live events: GET /ws (see WsEvent).',
      },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'tyr_session' },
          agent: { type: 'apiKey', in: 'header', name: 'x-tyr-signature' },
          admin: { type: 'http', scheme: 'bearer' },
        },
      },
    },
    // Prefix-root routes register as '/api/x/'; publish the canonical '/api/x'.
    transform: (route) => {
      const r = jsonSchemaTransform(route);
      return { ...r, url: r.url.replace(/(.)\/$/, '$1') };
    },
    transformObject: createJsonSchemaTransformObject({ schemas: components }),
  });
  await app.register(cookie, { secret: deps.cookieSecret });
  await app.register(websocket);
  app.decorate('db', deps.db);
  app.get(
    '/health',
    { schema: { tags: ['meta'], response: { 200: z.object({ ok: z.literal(true) }) } } },
    async () => ({ ok: true as const }),
  );
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
