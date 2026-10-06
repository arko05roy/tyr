// Phase 11b: a routed bet. The router splits the stake across venues listing the same event; each
// leg runs the full bet saga (Tempo stake, CT escrow, Position PDA, venue execution) under its own
// idempotency key `${key}:${venue}`, and every leg row carries routeKey = key. A retry re-quotes,
// so legs already placed resume and a leg that is no longer in the route is not placed.
import type { PrismaClient } from '@tyr/db';
import type { Executor } from '@tyr/hyperliquid';
import { routeOrder, type Route, type Side } from '@tyr/venues';
import { BetRejectedError, placeBet, type BetInput } from './bet.js';
import { venues } from './venue.js';

export type RoutedBetInput = Omit<BetInput, 'marketId' | 'outcome' | 'routeKey' | 'side'> & {
  eventKey: string;
  side: Side;
};

export async function quoteRoute(input: RoutedBetInput): Promise<Route> {
  let route: Route;
  try {
    route = await routeOrder(venues(), {
      eventKey: input.eventKey,
      side: input.side,
      stakeUsd: input.stakeUsd,
      ...(input.maxPrice !== undefined ? { maxPrice: input.maxPrice } : {}),
    });
  } catch (e) {
    throw new BetRejectedError((e as Error).message, 'market');
  }
  if (!route.legs.length)
    throw new BetRejectedError('no venue can fill a leg above its minimum for that stake', 'size');
  return route;
}

export async function placeRoutedBet(db: PrismaClient, exec: Executor, input: RoutedBetInput) {
  const placed = await db.order.findMany({
    where: { routeKey: input.idempotencyKey },
    include: { settlement: true },
  });
  if (placed.some((o) => o.userId !== input.userId))
    throw new Error('idempotency key belongs to another user');
  const route = await quoteRoute(input);

  const orders = [];
  for (const leg of route.legs) {
    orders.push(
      await placeBet(db, exec, {
        ...input,
        marketId: leg.marketId,
        // the leg's all-in cost is its stake; the limit is the worst level the router took
        stakeUsd: leg.costUsd,
        maxPrice: Math.min(input.maxPrice ?? 1, leg.limitPx * 1.02),
        idempotencyKey: `${input.idempotencyKey}:${leg.venue}`,
        routeKey: input.idempotencyKey,
      }),
    );
  }
  return { route, orders };
}
