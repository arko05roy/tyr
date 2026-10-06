// PRD 4.1 surface: featured HL testnet outcome markets + book detail (public, read-only).
import { featuredMarkets, market } from '@tyr/hyperliquid';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import { Market, MarketDetail, MarketParams, errors } from '../schemas.js';

const tags = ['markets'];

export const marketRoutes: TyrPlugin = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags,
        description: 'Featured outcome markets: unresolved, two-sided YES book right now.',
        response: { 200: z.object({ markets: z.array(Market) }) },
      },
    },
    async () => ({ markets: await featuredMarkets() }),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags,
        params: MarketParams,
        response: { 200: MarketDetail, ...errors(400, 404) },
      },
    },
    async (req, reply) => {
      const m = await market(req.params.id);
      if (!m) return reply.code(404).send({ error: 'unknown outcome' });
      return m;
    },
  );
};
