// PRD 5.1: Flow A over HTTP. Over-limit → 402 with the on-chain revert reason.
import type { Executor } from '@tyr/hyperliquid';
import {
  BetRejectedError,
  availableBalance,
  confidentialAccount,
  fromUnits,
  placeBet,
} from '@tyr/pipeline';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireUser } from './session.js';

const Bet = z.object({
  outcome: z.number().int().nonnegative(),
  side: z.enum(['yes', 'no']),
  stakeUsd: z.number().positive().max(1_000),
  idempotencyKey: z.string().min(8).max(128),
  maxPrice: z.number().gt(0).lt(1).optional(),
});

const STATUS = { market: 400, size: 400, balance: 409, limit: 402 } as const;

const view = (o: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

export const betRoutes =
  (exec: Executor): FastifyPluginAsync =>
  async (app) => {
    app.post('/', async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user || reply.sent) return;
      const body = Bet.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
      try {
        const order = await placeBet(app.db, exec, { userId: user.id, ...body.data });
        return reply.code(201).send(view(order));
      } catch (err) {
        if (err instanceof BetRejectedError)
          return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code });
        throw err;
      }
    });

    app.get('/', async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user || reply.sent) return;
      const orders = await app.db.order.findMany({
        where: { userId: user.id, idempotencyKey: { not: null } },
        include: { settlement: true },
        orderBy: { createdAt: 'desc' },
      });
      return { bets: orders.map(view) };
    });

    app.get('/:id', async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user || reply.sent) return;
      const { id } = req.params as { id: string };
      const order = await app.db.order.findFirst({
        where: { id, userId: user.id },
        include: { settlement: true },
      });
      if (!order) return reply.code(404).send({ error: 'not found' });
      return view(order);
    });
  };

export const balanceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const keys = await confidentialAccount(app.db, user.id);
    return { availableUsd: fromUnits(await availableBalance(keys)), token: 'tyrUSD' };
  });
};
