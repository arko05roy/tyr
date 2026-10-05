// PRD 4.1 surface: featured HL testnet outcome markets + book detail (public, read-only).
import { featuredMarkets, market } from '@tyr/hyperliquid';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const Params = z.object({ id: z.coerce.number().int().nonnegative() });

export const marketRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => ({ markets: await featuredMarkets() }));

  app.get('/:id', async (req, reply) => {
    const p = Params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const m = await market(p.data.id);
    if (!m) return reply.code(404).send({ error: 'unknown outcome' });
    return m;
  });
};
