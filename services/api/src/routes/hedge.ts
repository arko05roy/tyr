// PRD 9 / 11: Flow D hedge, geofenced server-side on the user's self-declared region (Stop 9).
//   GET  /api/hedge/markets/:marketId     → is a hedge offered here (drives the UI hedge card)
//   GET  /api/hedge/:orderId/quote        → simulated swap quote for an open bet (?amountUsd=)
//   POST /api/hedge                       → open it (real CT debit, simulated swap)
//   GET  /api/hedge · /api/hedge/:orderId → hedges + combined receipt once closed
import { market } from '@tyr/hyperliquid';
import {
  HedgeRejectedError,
  STOCK_TOKENS,
  combinedReceipt,
  hedgeEligibility,
  hedgeRule,
  openHedge,
  quoteHedge,
} from '@tyr/robinhood';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from './session.js';

const STATUS = {
  region: 403,
  order: 404,
  market: 400,
  size: 400,
  balance: 409,
  inventory: 409,
  price: 503,
} as const;

const Open = z.object({
  orderId: z.string().min(1).max(64),
  amountUsd: z.number().positive().max(1_000).optional(),
});

const view = (o: unknown) =>
  JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

const rejected = (reply: FastifyReply, err: unknown) => {
  if (err instanceof HedgeRejectedError)
    return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code });
  throw err;
};

export const hedgeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { marketId: string } }>('/markets/:marketId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const elig = hedgeEligibility(user.region);
    if (!elig.eligible) return reply.code(403).send({ error: elig.reason, code: 'region' });
    const m = await market(Number(req.params.marketId));
    if (!m) return reply.code(404).send({ error: 'unknown market' });
    const rule = hedgeRule(m.outcome);
    return rule
      ? {
          offered: true,
          stock: rule.stock,
          token: STOCK_TOKENS[rule.stock],
          rule: rule.rule,
          yesDirection: rule.yesDirection,
          simulated: true,
        }
      : { offered: false };
  });

  app.get<{ Params: { orderId: string }; Querystring: { amountUsd?: string } }>(
    '/:orderId/quote',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user || reply.sent) return;
      const amt = req.query.amountUsd !== undefined ? Number(req.query.amountUsd) : undefined;
      if (amt !== undefined && !Number.isFinite(amt))
        return reply.code(400).send({ error: 'amountUsd must be a number' });
      try {
        return await quoteHedge(app.db, user.id, req.params.orderId, amt);
      } catch (e) {
        return rejected(reply, e);
      }
    },
  );

  app.post('/', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const body = Open.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return reply
        .code(201)
        .send(view(await openHedge(app.db, user.id, body.data.orderId, body.data.amountUsd)));
    } catch (e) {
      return rejected(reply, e);
    }
  });

  const withReceipt = async (
    h: Parameters<typeof combinedReceipt>[0] & {
      status: string;
      receiptId: string | null;
      receiptTx: string | null;
    },
  ) => {
    if (h.status !== 'closed') return view(h);
    const s = await app.db.settlement.findUniqueOrThrow({ where: { orderId: h.orderId } });
    const r = h.receiptId ? await app.db.receipt.findUnique({ where: { id: h.receiptId } }) : null;
    return view({
      ...h,
      receipt: {
        ...combinedReceipt(h, s),
        id: h.receiptId,
        payloadHash: r?.payloadHash,
        tempoMemoTx: h.receiptTx,
      },
    });
  };

  app.get('/', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const hs = await app.db.hedge.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { hedges: await Promise.all(hs.map(withReceipt)) };
  });

  app.get<{ Params: { orderId: string } }>('/:orderId', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const h = await app.db.hedge.findFirst({
      where: { orderId: req.params.orderId, userId: user.id },
    });
    if (!h) return reply.code(404).send({ error: 'no hedge for that bet' });
    return withReceipt(h);
  });
};
