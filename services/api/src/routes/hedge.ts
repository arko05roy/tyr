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
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import {
  Hedge,
  HedgeOffer,
  HedgeOpen,
  HedgeQuote,
  HedgeQuoteQuery,
  HedgeWithReceipt,
  errors,
} from '../schemas.js';
import { authUser, userOf } from './session.js';

const STATUS = {
  region: 403,
  order: 404,
  market: 400,
  size: 400,
  balance: 409,
  inventory: 409,
  price: 503,
} as const;

const rejected = (reply: FastifyReply, err: unknown) => {
  if (err instanceof HedgeRejectedError)
    return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code });
  throw err;
};

const route = { preValidation: authUser };
const tags = ['hedge'];
const security = [{ session: [] }];

export const hedgeRoutes: TyrPlugin = async (app) => {
  app.get(
    '/markets/:marketId',
    {
      ...route,
      schema: {
        tags,
        security,
        description: 'Whether a hedge is offered for this market (drives the hedge card).',
        params: z.object({ marketId: z.coerce.number().int().nonnegative() }),
        response: { 200: HedgeOffer, ...errors(400, 401, 403, 404) },
      },
    },
    async (req, reply) => {
      const elig = hedgeEligibility(userOf(req).region);
      if (!elig.eligible) return reply.code(403).send({ error: elig.reason, code: 'region' });
      const m = await market(req.params.marketId);
      if (!m) return reply.code(404).send({ error: 'unknown market' });
      const rule = hedgeRule(m.outcome);
      return rule
        ? {
            offered: true as const,
            stock: rule.stock,
            token: STOCK_TOKENS[rule.stock],
            rule: rule.rule,
            yesDirection: rule.yesDirection,
            simulated: true as const,
          }
        : { offered: false as const };
    },
  );

  app.get(
    '/:orderId/quote',
    {
      ...route,
      schema: {
        tags,
        security,
        description: 'Simulated swap quote for an open bet; amount defaults to the stake.',
        params: z.object({ orderId: z.string().min(1) }),
        querystring: HedgeQuoteQuery,
        response: { 200: HedgeQuote, ...errors(400, 401, 403, 404, 409, 503) },
      },
    },
    async (req, reply) => {
      try {
        return await quoteHedge(app.db, userOf(req).id, req.params.orderId, req.query.amountUsd);
      } catch (e) {
        return rejected(reply, e);
      }
    },
  );

  app.post(
    '/',
    {
      ...route,
      schema: {
        tags,
        security,
        description: 'Open a hedge on an open bet: real confidential debit, simulated swap.',
        body: HedgeOpen,
        response: { 201: Hedge, ...errors(400, 401, 403, 404, 409, 503) },
      },
    },
    async (req, reply) => {
      try {
        const h = await openHedge(app.db, userOf(req).id, req.body.orderId, req.body.amountUsd);
        return reply.code(201).send(h);
      } catch (e) {
        return rejected(reply, e);
      }
    },
  );

  const withReceipt = async (
    h: Parameters<typeof combinedReceipt>[0] & {
      status: string;
      receiptId: string | null;
      receiptTx: string | null;
    },
  ) => {
    if (h.status !== 'closed') return h;
    const s = await app.db.settlement.findUniqueOrThrow({ where: { orderId: h.orderId } });
    const r = h.receiptId ? await app.db.receipt.findUnique({ where: { id: h.receiptId } }) : null;
    return {
      ...h,
      receipt: {
        ...combinedReceipt(h, s),
        id: h.receiptId,
        payloadHash: r?.payloadHash,
        tempoMemoTx: h.receiptTx,
      },
    };
  };

  app.get(
    '/',
    {
      ...route,
      schema: {
        tags,
        security,
        response: { 200: z.object({ hedges: z.array(HedgeWithReceipt) }), ...errors(401) },
      },
    },
    async (req) => {
      const hs = await app.db.hedge.findMany({
        where: { userId: userOf(req).id },
        orderBy: { createdAt: 'desc' },
      });
      return { hedges: await Promise.all(hs.map(withReceipt)) };
    },
  );

  app.get(
    '/:orderId',
    {
      ...route,
      schema: {
        tags,
        security,
        params: z.object({ orderId: z.string().min(1) }),
        response: { 200: HedgeWithReceipt, ...errors(401, 404) },
      },
    },
    async (req, reply) => {
      const h = await app.db.hedge.findFirst({
        where: { orderId: req.params.orderId, userId: userOf(req).id },
      });
      if (!h) return reply.code(404).send({ error: 'no hedge for that bet' });
      return withReceipt(h);
    },
  );
};
