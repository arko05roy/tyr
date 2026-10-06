// Multi-venue surface: every prediction venue normalized into one market shape (public, read-only).
//   GET  /api/venues                     → venues, chain, mode (live | simulated), revenue model
//   GET  /api/venues/markets             → all markets across venues (?venue=&category=)
//   GET  /api/venues/markets/:id         → one market, books for both sides
//   GET  /api/venues/events              → same question grouped across venues, best price per side
//   POST /api/venues/route               → best-execution split for a stake across venues (quote only)
import {
  defaultRegistry,
  groupEvents,
  parseMarketId,
  routeOrder,
  type VenueRegistry,
} from '@tyr/venues';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import { UnifiedEvent, UnifiedMarket, VenueInfo, VenueRoute, errors } from '../schemas.js';

const tags = ['venues'];
const VenueId = z.enum(['hyperliquid', 'polymarket', 'kalshi', 'limitless']);
const Levels = z.array(z.object({ px: z.number(), sz: z.number() }));
const SideBook = z.object({ bids: Levels, asks: Levels });

export const venueRoutes =
  (reg: VenueRegistry = defaultRegistry()): TyrPlugin =>
  async (app) => {
    app.get(
      '/',
      { schema: { tags, response: { 200: z.object({ venues: z.array(VenueInfo) }) } } },
      async () => ({ venues: reg.venues.map((v) => v.info) }),
    );

    app.get(
      '/markets',
      {
        schema: {
          tags,
          description:
            'Every market on every venue, one shape. Simulated venues are labeled by mode.',
          querystring: z.object({ venue: VenueId.optional(), category: z.string().optional() }),
          response: {
            200: z.object({
              markets: z.array(UnifiedMarket),
              errors: z.array(z.object({ venue: VenueId, error: z.string() })),
            }),
          },
        },
      },
      async (req) => {
        const { markets, errors } = await reg.markets();
        const { venue, category } = req.query;
        return {
          markets: markets.filter(
            (m) => (!venue || m.venue === venue) && (!category || m.category === category),
          ),
          errors,
        };
      },
    );

    app.get(
      '/markets/:id',
      {
        schema: {
          tags,
          params: z.object({ id: z.string().describe('`venue:nativeId`') }),
          response: {
            200: z.object({
              market: UnifiedMarket,
              books: z.object({ yes: SideBook, no: SideBook }),
            }),
            ...errors(400, 404),
          },
        },
      },
      async (req, reply) => {
        let parsed;
        try {
          parsed = parseMarketId(req.params.id);
          reg.venue(parsed.venue);
        } catch {
          return reply.code(400).send({ error: 'id must be venue:nativeId with a known venue' });
        }
        const market = await reg.market(req.params.id);
        if (!market) return reply.code(404).send({ error: 'unknown market' });
        const v = reg.venue(parsed.venue);
        const [yes, no] = await Promise.all([
          v.book(parsed.nativeId, 'yes'),
          v.book(parsed.nativeId, 'no'),
        ]);
        return { market, books: { yes, no } };
      },
    );

    app.get(
      '/events',
      {
        schema: {
          tags,
          description: 'Markets grouped by real-world question; multi-venue events first.',
          querystring: z.object({ multiVenue: z.coerce.boolean().optional() }),
          response: { 200: z.object({ events: z.array(UnifiedEvent) }) },
        },
      },
      async (req) => {
        const events = groupEvents((await reg.markets()).markets);
        return {
          events: req.query.multiVenue ? events.filter((e) => e.venues.length > 1) : events,
        };
      },
    );

    app.post(
      '/route',
      {
        schema: {
          tags,
          description:
            'Best-execution quote: split a stake across venues by all-in price (fees included).',
          body: z.object({
            eventKey: z.string(),
            side: z.enum(['yes', 'no']),
            stakeUsd: z.number().positive().max(1_000_000),
            maxPrice: z.number().gt(0).lt(1).optional(),
            venues: z.array(VenueId).optional(),
          }),
          response: { 200: VenueRoute, ...errors(404) },
        },
      },
      async (req, reply) => {
        const { maxPrice, venues, ...q } = req.body;
        try {
          return await routeOrder(reg, {
            ...q,
            ...(maxPrice ? { maxPrice } : {}),
            ...(venues ? { venues } : {}),
          });
        } catch (err) {
          if (/no venue lists/.test((err as Error).message))
            return reply.code(404).send({ error: (err as Error).message });
          throw err;
        }
      },
    );
  };
