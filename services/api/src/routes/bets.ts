// PRD 5.1: Flow A over HTTP. Over-limit → 402 with the on-chain revert reason.
// Phase 11b: a bet targets any venue market (`marketId`), or an event routed across venues
// (`POST /routed`, one saga per leg).
import type { Executor } from '@tyr/hyperliquid';
import {
  BetRejectedError,
  availableBalance,
  confidentialAccount,
  fromUnits,
  placeBet,
  placeRoutedBet,
} from '@tyr/pipeline';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import {
  Balance,
  BetInput,
  IdParams,
  Order,
  RoutedBetInput,
  VenueRoute,
  errors,
} from '../schemas.js';
import { authUser, userOf } from './session.js';

const STATUS = { market: 400, size: 400, balance: 409, limit: 402 } as const;
const route = { preValidation: authUser };
const tags = ['bets'];
const security = [{ session: [] }];

export const betRoutes =
  (exec: Executor): TyrPlugin =>
  async (app) => {
    app.post(
      '/',
      {
        ...route,
        schema: {
          tags,
          security,
          description:
            'Place a bet (Flow A) on one venue market. 402 = loss limit exceeded on-chain, ' +
            '409 = insufficient confidential balance. Replaying an idempotencyKey returns the ' +
            'same order. Fills on simulated venues carry simulated: true.',
          body: BetInput,
          response: { 201: Order, ...errors(400, 401, 402, 409) },
        },
      },
      async (req, reply) => {
        try {
          const order = await placeBet(app.db, exec, { userId: userOf(req).id, ...req.body });
          return reply.code(201).send(order);
        } catch (err) {
          if (err instanceof BetRejectedError)
            return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code });
          throw err;
        }
      },
    );

    app.post(
      '/routed',
      {
        ...route,
        schema: {
          tags,
          security,
          description:
            'Route a stake across every venue listing the event (best all-in price first); each ' +
            'leg is a full Flow A bet keyed `${idempotencyKey}:${venue}` and shares routeKey. ' +
            'Status codes as POST /api/bets; legs placed before a rejection stay placed.',
          body: RoutedBetInput,
          response: {
            201: z.object({ route: VenueRoute, orders: z.array(Order) }),
            ...errors(400, 401, 402, 409),
          },
        },
      },
      async (req, reply) => {
        try {
          const res = await placeRoutedBet(app.db, exec, { userId: userOf(req).id, ...req.body });
          return reply.code(201).send(res);
        } catch (err) {
          if (err instanceof BetRejectedError)
            return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code });
          throw err;
        }
      },
    );

    app.get(
      '/',
      {
        ...route,
        schema: {
          tags,
          security,
          response: { 200: z.object({ bets: z.array(Order) }), ...errors(401) },
        },
      },
      async (req) => {
        const orders = await app.db.order.findMany({
          where: { userId: userOf(req).id, idempotencyKey: { not: null } },
          include: { settlement: true },
          orderBy: { createdAt: 'desc' },
        });
        return { bets: orders };
      },
    );

    app.get(
      '/:id',
      {
        ...route,
        schema: { tags, security, params: IdParams, response: { 200: Order, ...errors(401, 404) } },
      },
      async (req, reply) => {
        const order = await app.db.order.findFirst({
          where: { id: req.params.id, userId: userOf(req).id },
          include: { settlement: true },
        });
        if (!order) return reply.code(404).send({ error: 'not found' });
        return order;
      },
    );
  };

export const balanceRoutes: TyrPlugin = async (app) => {
  app.get(
    '/',
    {
      ...route,
      schema: {
        tags: ['balance'],
        security,
        description: 'Confidential tyrUSD balance, decrypted server-side for the owner only.',
        response: { 200: Balance, ...errors(401) },
      },
    },
    async (req) => {
      const keys = await confidentialAccount(app.db, userOf(req).id);
      return { availableUsd: fromUnits(await availableBalance(keys)), token: 'tyrUSD' as const };
    },
  );
};
