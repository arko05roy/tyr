// PRD 4.5: builder-fee revenue. Bearer TYR_ADMIN_TOKEN (operator-only).
import { timingSafeEqual } from 'node:crypto';
import { builderRevenue } from '@tyr/hyperliquid';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import { errors } from '../schemas.js';

const authorized = (header: string | undefined) => {
  const token = process.env.TYR_ADMIN_TOKEN;
  if (!token || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

const Revenue = z.object({
  builder: z.string(),
  feeTenthsBps: z.number(),
  hl: z.object({ builderRewardsUsd: z.number() }),
  ledger: z.object({
    live: z.object({ orders: z.number(), feesUsd: z.number() }),
    simulated: z.object({ orders: z.number(), feesUsd: z.number() }),
  }),
});

export const adminRoutes: TyrPlugin = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    if (!authorized(req.headers.authorization))
      return reply.code(401).send({ error: 'admin only' });
  });
  app.get(
    '/revenue',
    {
      schema: {
        tags: ['admin'],
        security: [{ admin: [] }],
        description: 'Builder fee earned: HL referral state (live) and tyr ledger (live vs paper).',
        response: { 200: Revenue, ...errors(401) },
      },
    },
    async () => builderRevenue(app.db),
  );
};
