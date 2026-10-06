// Simulated venues: deterministic modeled books for venues tyr does not call yet. Every number is
// derived from (event fair price, venue skew, time bucket), so the same inputs give the same book in
// tests, and prices still drift in the demo. Fills carry simulated: true — never a venue ref.
import { createHash } from 'node:crypto';
import {
  marketId,
  walk,
  type Category,
  type Fill,
  type Market,
  type OrderRequest,
  type Side,
  type SideBook,
  type Venue,
  type VenueInfo,
} from '../types.js';

export type Listing = {
  nativeId: string;
  title: string;
  category: Category;
  eventKey: string;
  resolvesAt: string;
  /** fair YES probability the venue's book is centered on (before skew and drift) */
  fair: number;
};

export type SimProfile = {
  /** half-spread in price units */
  halfSpread: number;
  /** contracts per level at the touch; deeper levels grow linearly */
  depth: number;
  /** venue-specific bias in price units (different crowds price the same event differently) */
  skew: number;
  fee: (px: number, sz: number) => number;
};

const DRIFT_BUCKET_MS = 30_000;
const LEVELS = 5;

/** deterministic float in [-1, 1] from a string */
function noise(s: string) {
  return (createHash('sha256').update(s).digest().readUInt32BE(0) / 0xffffffff) * 2 - 1;
}

const clamp = (p: number) => Math.min(0.98, Math.max(0.02, p));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class SimulatedVenue implements Venue {
  constructor(
    readonly info: VenueInfo,
    private readonly profile: SimProfile,
    private readonly listings: () => Promise<Listing[]>,
    private readonly now: () => number = Date.now,
  ) {}

  private mid(l: Listing) {
    const bucket = Math.floor(this.now() / DRIFT_BUCKET_MS);
    const drift = 0.01 * noise(`${this.info.id}:${l.nativeId}:${bucket}`);
    const venueBias = this.profile.skew * noise(`${this.info.id}:${l.eventKey}`);
    return clamp(l.fair + venueBias + drift);
  }

  private yesBook(l: Listing): SideBook {
    const mid = this.mid(l);
    const { halfSpread: h, depth } = this.profile;
    const tick = Math.max(0.005, h);
    const bids: SideBook['bids'] = [];
    const asks: SideBook['asks'] = [];
    for (let i = 0; i < LEVELS; i++) {
      const sz = Math.round(depth * (1 + i) * (1 + 0.3 * noise(`${l.nativeId}:${i}`)));
      bids.push({ px: r3(clamp(mid - h - i * tick)), sz });
      asks.push({ px: r3(clamp(mid + h + i * tick)), sz });
    }
    return { bids, asks };
  }

  private toMarket(l: Listing): Market {
    const b = this.yesBook(l);
    const bid = b.bids[0]?.px ?? 0;
    const ask = b.asks[0]?.px ?? 1;
    const liquidityUsd = [...b.bids, ...b.asks].reduce((s, x) => s + x.px * x.sz, 0);
    return {
      id: marketId(this.info.id, l.nativeId),
      venue: this.info.id,
      nativeId: l.nativeId,
      title: l.title,
      category: l.category,
      eventKey: l.eventKey,
      resolvesAt: l.resolvesAt,
      yes: { bid, ask, mid: r3((bid + ask) / 2) },
      liquidityUsd: Math.round(liquidityUsd),
    };
  }

  private async listing(nativeId: string) {
    return (await this.listings()).find((l) => l.nativeId === nativeId) ?? null;
  }

  async markets() {
    const now = new Date(this.now()).toISOString();
    return (await this.listings()).filter((l) => l.resolvesAt > now).map((l) => this.toMarket(l));
  }

  async market(nativeId: string) {
    const l = await this.listing(nativeId);
    return l ? this.toMarket(l) : null;
  }

  async book(nativeId: string, side: Side): Promise<SideBook> {
    const l = await this.listing(nativeId);
    if (!l) throw new Error(`${this.info.id}: unknown market ${nativeId}`);
    const yes = this.yesBook(l);
    if (side === 'yes') return yes;
    // NO book mirrors YES: buying NO at p == selling YES at 1 − p.
    const flip = (x: { px: number; sz: number }) => ({ px: r3(1 - x.px), sz: x.sz });
    return { bids: yes.asks.map(flip), asks: yes.bids.map(flip) };
  }

  takerFee(px: number, sz: number) {
    return this.profile.fee(px, sz);
  }

  async execute(req: OrderRequest): Promise<Fill> {
    const nativeId = req.marketId.slice(req.marketId.indexOf(':') + 1);
    const base = { venue: this.info.id, marketId: req.marketId, simulated: true } as const;
    if (req.sz * req.limitPx < this.info.minOrderUsd)
      return {
        ...base,
        status: 'rejected',
        filledSz: 0,
        avgPx: 0,
        notionalUsd: 0,
        feeUsd: 0,
        error: `minimum order is $${this.info.minOrderUsd}`,
      };
    const w = walk((await this.book(nativeId, req.side)).asks, req.sz, req.limitPx);
    return {
      ...base,
      status: w.filled <= 0 ? 'canceled' : w.filled + 1e-9 >= req.sz ? 'filled' : 'partial',
      filledSz: w.filled,
      avgPx: w.avgPx,
      notionalUsd: w.notional,
      feeUsd: this.takerFee(w.avgPx, w.filled),
    };
  }
}
