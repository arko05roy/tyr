// PRD 4.5: builder-fee revenue. Bearer TYR_ADMIN_TOKEN (operator-only).
import { timingSafeEqual } from 'node:crypto';
import { builderRevenue } from '@tyr/hyperliquid';
import type { FastifyPluginAsync } from 'fastify';

const authorized = (header: string | undefined) => {
  const token = process.env.TYR_ADMIN_TOKEN;
  if (!token || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    if (!authorized(req.headers.authorization))
      return reply.code(401).send({ error: 'admin only' });
  });
  app.get('/revenue', async () => builderRevenue(app.db));
};
