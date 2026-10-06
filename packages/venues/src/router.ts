// Smart order router: for one event and side, merge every venue's asks ranked by all-in price
// (px + that venue's taker fee per contract) and fill the stake greedily. Legs under a venue's
// minimum are dropped. Result compares the split route against the best and worst single venue.
import type { VenueRegistry } from './registry.js';
import { walk, type Fill, type Market, type Side, type Venue, type VenueId } from './types.js';

export type Leg = {
  venue: VenueId;
  marketId: string;
  sz: number;
  avgPx: number;
  limitPx: number;
  costUsd: number;
  feeUsd: number;
};
export type SingleQuote = { venue: VenueId; marketId: string; contracts: number; costUsd: number };
export type Route = {
  eventKey: string;
  side: Side;
  stakeUsd: number;
  legs: Leg[];
  contracts: number;
  costUsd: number;
  avgAllInPx: number;
  singles: SingleQuote[];
  /** extra contracts the route buys versus the worst single venue for the same stake */
  edgeVsWorst: number;
};

type Ask = { venue: Venue; market: Market; px: number; sz: number; allIn: number };

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Contracts one venue gives for `stakeUsd`, fees included. */
function single(asks: Ask[], stakeUsd: number, maxPrice: number) {
  let budget = stakeUsd;
  let contracts = 0;
  for (const a of asks) {
    if (a.px > maxPrice || budget <= 0) break;
    const take = Math.min(a.sz, Math.floor(budget / a.allIn));
    if (take <= 0) break;
    contracts += take;
    budget -= take * a.allIn;
  }
  return { contracts, costUsd: r4(stakeUsd - budget) };
}

export async function routeOrder(
  reg: VenueRegistry,
  q: { eventKey: string; side: Side; stakeUsd: number; maxPrice?: number; venues?: VenueId[] },
): Promise<Route> {
  const maxPrice = q.maxPrice ?? 0.99;
  const { markets } = await reg.markets();
  const candidates = markets.filter(
    (m) => m.eventKey === q.eventKey && (!q.venues || q.venues.includes(m.venue)),
  );
  if (!candidates.length) throw new Error(`no venue lists ${q.eventKey}`);

  const perVenue = await Promise.all(
    candidates.map(async (market) => {
      const venue = reg.venue(market.venue);
      const book = await venue.book(market.nativeId, q.side);
      return book.asks.map((l): Ask => ({
        venue,
        market,
        px: l.px,
        sz: l.sz,
        allIn: l.px + venue.takerFee(l.px, 1),
      }));
    }),
  );

  const singles = perVenue
    .map((asks, i) => ({
      venue: (candidates[i] as Market).venue,
      marketId: (candidates[i] as Market).id,
      ...single(asks, q.stakeUsd, maxPrice),
    }))
    .sort((a, b) => b.contracts - a.contracts);

  // Greedy split over the merged book.
  const merged = perVenue
    .flat()
    .filter((a) => a.px <= maxPrice)
    .sort((a, b) => a.allIn - b.allIn);
  let budget = q.stakeUsd;
  const take = new Map<string, { a: Ask; sz: number; worst: number }>();
  for (const a of merged) {
    const n = Math.min(a.sz, Math.floor(budget / a.allIn));
    if (n <= 0) continue;
    const cur = take.get(a.market.id) ?? { a, sz: 0, worst: 0 };
    take.set(a.market.id, { a, sz: cur.sz + n, worst: Math.max(cur.worst, a.px) });
    budget -= n * a.allIn;
  }

  const legs: Leg[] = [];
  for (const { a, sz, worst } of take.values()) {
    const book = await a.venue.book(a.market.nativeId, q.side);
    const w = walk(book.asks, sz, worst);
    if (w.notional < a.venue.info.minOrderUsd) continue;
    const feeUsd = r4(a.venue.takerFee(w.avgPx, w.filled));
    legs.push({
      venue: a.market.venue,
      marketId: a.market.id,
      sz: w.filled,
      avgPx: r4(w.avgPx),
      limitPx: worst,
      costUsd: r4(w.notional + feeUsd),
      feeUsd,
    });
  }
  legs.sort((a, b) => b.sz - a.sz);
  const contracts = legs.reduce((s, l) => s + l.sz, 0);
  const costUsd = r4(legs.reduce((s, l) => s + l.costUsd, 0));
  return {
    eventKey: q.eventKey,
    side: q.side,
    stakeUsd: q.stakeUsd,
    legs,
    contracts,
    costUsd,
    avgAllInPx: contracts ? r4(costUsd / contracts) : 0,
    singles,
    edgeVsWorst: contracts - (singles.at(-1)?.contracts ?? 0),
  };
}

/** Execute every leg of a route on its venue (simulated venues return simulated fills). */
export async function executeRoute(reg: VenueRegistry, route: Route): Promise<Fill[]> {
  return Promise.all(
    route.legs.map((l) =>
      reg
        .venue(l.venue)
        .execute({ marketId: l.marketId, side: route.side, sz: l.sz, limitPx: l.limitPx }),
    ),
  );
}
