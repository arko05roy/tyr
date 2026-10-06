// Venue-agnostic market model. Every venue (live or simulated) is normalized into these shapes,
// so discovery, cross-venue matching and routing never see venue-specific encodings.

export type VenueId = 'hyperliquid' | 'polymarket' | 'kalshi' | 'limitless';
export type Side = 'yes' | 'no';
export type Category = 'crypto' | 'macro' | 'finance' | 'politics' | 'sports' | 'culture' | 'other';

export type VenueInfo = {
  id: VenueId;
  name: string;
  /** where positions settle — the chain tyr has to reach to fund and unwind */
  settlementChain: 'hypercore' | 'polygon' | 'solana' | 'base';
  collateral: string;
  /** live = real venue API; simulated = modeled book (no venue call, results carry simulated: true) */
  mode: 'live' | 'simulated';
  /** how tyr earns on routed flow at this venue */
  revenue: string;
  minOrderUsd: number;
};

export type Level = { px: number; sz: number };
/** One side's book: bids descending, asks ascending; px in [0,1] = probability price per contract. */
export type SideBook = { bids: Level[]; asks: Level[] };

export type Market = {
  /** globally unique: `${venue}:${nativeId}` */
  id: string;
  venue: VenueId;
  nativeId: string;
  title: string;
  category: Category;
  /**
   * Canonical event key: equal across venues when they list the same real-world question, e.g.
   * `fed:2026-10-28:cut25`. Drives the cross-venue comparison and the router.
   */
  eventKey: string;
  resolvesAt: string;
  yes: { bid: number; ask: number; mid: number };
  liquidityUsd: number;
};

export type OrderRequest = {
  marketId: string;
  side: Side;
  /** contracts */
  sz: number;
  /** worst acceptable price per contract */
  limitPx: number;
};

export type Fill = {
  venue: VenueId;
  marketId: string;
  simulated: boolean;
  status: 'filled' | 'partial' | 'canceled' | 'rejected';
  filledSz: number;
  avgPx: number;
  notionalUsd: number;
  feeUsd: number;
  venueRef?: string;
  error?: string;
};

export interface Venue {
  readonly info: VenueInfo;
  markets(): Promise<Market[]>;
  market(nativeId: string): Promise<Market | null>;
  book(nativeId: string, side: Side): Promise<SideBook>;
  /** venue taker fee in USD for `sz` contracts at `px` (each venue has its own schedule) */
  takerFee(px: number, sz: number): number;
  execute(req: OrderRequest): Promise<Fill>;
}

export const marketId = (venue: VenueId, nativeId: string) => `${venue}:${nativeId}`;
export function parseMarketId(id: string): { venue: VenueId; nativeId: string } {
  const i = id.indexOf(':');
  if (i < 1) throw new Error(`bad market id ${id}`);
  return { venue: id.slice(0, i) as VenueId, nativeId: id.slice(i + 1) };
}

/** Walk asks up to limitPx for `sz` contracts (buying YES or NO). */
export function walk(asks: Level[], sz: number, limitPx: number) {
  let left = sz;
  let notional = 0;
  for (const l of asks) {
    if (left <= 1e-12 || l.px > limitPx) break;
    const take = Math.min(left, l.sz);
    notional += take * l.px;
    left -= take;
  }
  const filled = sz - left;
  return { filled, notional, avgPx: filled ? notional / filled : 0 };
}
