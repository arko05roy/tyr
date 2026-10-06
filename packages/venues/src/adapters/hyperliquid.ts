// Live adapter: HIP-4 outcome markets on HL testnet, normalized. Execution stays in the existing
// Flow A pipeline (@tyr/pipeline placeBet) — this adapter's execute() is a paper walk of the real
// book so the router can compare venues on equal terms.
import {
  MIN_ORDER_USD,
  bookFor,
  builderCode,
  builderFeeUsd,
  featuredMarkets,
  market,
  parseTemplate,
} from '@tyr/hyperliquid';
import type { Market as HlMarket } from '@tyr/hyperliquid';
import {
  marketId,
  parseMarketId,
  walk,
  type Category,
  type Market,
  type Side,
  type SideBook,
  type Venue,
} from '../types.js';

const side = (s: Side) => (s === 'yes' ? 0 : 1);

/** Template markets get a key other venues can match; free-form ones stay venue-unique. */
export function hlEventKey(m: { outcome: number; description: string; resolvesAt: string }) {
  const t = parseTemplate(m.description);
  const asset = t?.perp?.split(':').at(-1);
  if (asset && t?.threshold)
    return `price:${asset.toLowerCase()}:${t.threshold}:${m.resolvesAt.slice(0, 16)}`;
  return `hl:${m.outcome}`;
}

function category(m: HlMarket): Category {
  const s = `${m.name} ${m.description}`.toLowerCase();
  if (/fed|fomc|cpi|rate|inflation/.test(s)) return 'macro';
  if (/sports|nba|nfl|soccer|match/.test(s)) return 'sports';
  if (/perp:xyz|stock|nvda|tsla|spx/.test(s)) return 'finance';
  if (/btc|eth|sol|hype|crypto|binaryprice/.test(s)) return 'crypto';
  return 'other';
}

const normalize = (m: HlMarket): Market => ({
  id: marketId('hyperliquid', String(m.outcome)),
  venue: 'hyperliquid',
  nativeId: String(m.outcome),
  title:
    m.template?.perp && m.template.threshold
      ? `${m.template.perp.split(':').at(-1)} above ${m.template.threshold} at ${m.resolvesAt.slice(0, 16).replace('T', ' ')} UTC`
      : (m.template?.instrument ?? m.name),
  category: category(m),
  eventKey: hlEventKey(m),
  resolvesAt: m.resolvesAt,
  yes: { bid: m.yes.bid, ask: m.yes.ask, mid: m.yes.mid },
  liquidityUsd: 0,
});

const levels = (ls: { px: string; sz: string }[]) =>
  ls.map((l) => ({ px: Number(l.px), sz: Number(l.sz) }));

export class HyperliquidVenue implements Venue {
  readonly info = {
    id: 'hyperliquid',
    name: 'Hyperliquid (HIP-4)',
    settlementChain: 'hypercore',
    collateral: 'USDC',
    mode: 'live',
    revenue: 'builder code fee on every routed order',
    minOrderUsd: MIN_ORDER_USD,
  } as const;

  async markets() {
    return (await featuredMarkets()).map(normalize);
  }

  async market(nativeId: string) {
    return (await this.markets()).find((m) => m.nativeId === nativeId) ?? null;
  }

  async book(nativeId: string, s: Side): Promise<SideBook> {
    const b = await bookFor(Number(nativeId), side(s));
    return { bids: levels(b.levels[0]), asks: levels(b.levels[1]) };
  }

  takerFee(px: number, sz: number) {
    return builderFeeUsd(px * sz, builderCode().f);
  }

  async execute(req: Parameters<Venue['execute']>[0]) {
    const { nativeId } = parseMarketId(req.marketId);
    if (!(await market(Number(nativeId)))) throw new Error(`unknown HL outcome ${nativeId}`);
    const w = walk((await this.book(nativeId, req.side)).asks, req.sz, req.limitPx);
    return {
      venue: 'hyperliquid' as const,
      marketId: req.marketId,
      simulated: true,
      status:
        w.filled <= 0
          ? ('canceled' as const)
          : w.filled + 1e-9 >= req.sz
            ? ('filled' as const)
            : ('partial' as const),
      filledSz: w.filled,
      avgPx: w.avgPx,
      notionalUsd: w.notional,
      feeUsd: this.takerFee(w.avgPx, w.filled),
    };
  }
}
