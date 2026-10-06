// The venue set tyr routes across. HL is live; the rest are simulated until their adapters go live.
import { HyperliquidVenue } from './adapters/hyperliquid.js';
import { simulatedVenues } from './adapters/catalog.js';
import { parseMarketId, type Market, type Venue, type VenueId } from './types.js';

export class VenueRegistry {
  private readonly byId: Map<VenueId, Venue>;

  constructor(readonly venues: Venue[]) {
    this.byId = new Map(venues.map((v) => [v.info.id, v]));
  }

  venue(id: VenueId) {
    const v = this.byId.get(id);
    if (!v) throw new Error(`unknown venue ${id}`);
    return v;
  }

  /** All markets from every venue; a venue that is down is skipped, not fatal. */
  async markets(): Promise<{ markets: Market[]; errors: { venue: VenueId; error: string }[] }> {
    const res = await Promise.allSettled(this.venues.map((v) => v.markets()));
    const markets: Market[] = [];
    const errors: { venue: VenueId; error: string }[] = [];
    res.forEach((r, i) => {
      const venue = (this.venues[i] as Venue).info.id;
      if (r.status === 'fulfilled') markets.push(...r.value);
      else errors.push({ venue, error: String((r.reason as Error)?.message ?? r.reason) });
    });
    markets.sort((a, b) => a.resolvesAt.localeCompare(b.resolvesAt));
    return { markets, errors };
  }

  async market(id: string) {
    const { venue, nativeId } = parseMarketId(id);
    return this.venue(venue).market(nativeId);
  }
}

export function defaultRegistry(opts: { now?: () => number } = {}) {
  const hl = new HyperliquidVenue();
  return new VenueRegistry([hl, ...simulatedVenues(() => hl.markets(), opts.now)]);
}
