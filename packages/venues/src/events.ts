// Cross-venue view: group markets that ask the same question (same eventKey) and price them side
// by side. Spread between venues is the headline number for the "one terminal, every venue" pitch.
import type { Market, VenueId } from './types.js';

export type Event = {
  eventKey: string;
  title: string;
  category: Market['category'];
  resolvesAt: string;
  venues: {
    venue: VenueId;
    marketId: string;
    yesBid: number;
    yesAsk: number;
    liquidityUsd: number;
  }[];
  bestYesAsk: { venue: VenueId; px: number };
  bestNoAsk: { venue: VenueId; px: number };
  /** max − min YES mid across venues, in price units */
  priceGap: number;
};

export function groupEvents(markets: Market[]): Event[] {
  const groups = new Map<string, Market[]>();
  for (const m of markets) groups.set(m.eventKey, [...(groups.get(m.eventKey) ?? []), m]);
  return [...groups.entries()]
    .map(([eventKey, ms]) => {
      const first = ms[0] as Market;
      const yes = ms.reduce((a, b) => (b.yes.ask < a.yes.ask ? b : a));
      // NO ask = 1 − YES bid on a binary book.
      const no = ms.reduce((a, b) => (b.yes.bid > a.yes.bid ? b : a));
      const mids = ms.map((m) => m.yes.mid);
      return {
        eventKey,
        title: first.title,
        category: first.category,
        resolvesAt: first.resolvesAt,
        venues: ms.map((m) => ({
          venue: m.venue,
          marketId: m.id,
          yesBid: m.yes.bid,
          yesAsk: m.yes.ask,
          liquidityUsd: m.liquidityUsd,
        })),
        bestYesAsk: { venue: yes.venue, px: yes.yes.ask },
        bestNoAsk: { venue: no.venue, px: Math.round((1 - no.yes.bid) * 1000) / 1000 },
        priceGap: Math.round((Math.max(...mids) - Math.min(...mids)) * 1000) / 1000,
      };
    })
    .sort((a, b) => b.venues.length - a.venues.length || b.priceGap - a.priceGap);
}
