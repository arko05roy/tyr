// Venue profiles + listings for the simulated venues. Fee schedules and venue facts are MODELED
// from public descriptions (as of mid-2026) and must be re-checked before any live integration.
import type { Market } from '../types.js';
import { SimulatedVenue, type Listing, type SimProfile } from './simulated.js';

const day = 86_400_000;
const at = (days: number, now = Date.now()) =>
  new Date(Math.floor((now + days * day) / day) * day + 18 * 3_600_000).toISOString();

/** Real-world events several venues list at once (fair = shared consensus before venue skew). */
function sharedEvents(): (Listing & { venues: string[] })[] {
  return [
    {
      nativeId: 'fed-oct-cut25',
      title: 'Fed cuts rates 25bp at the October FOMC',
      category: 'macro',
      eventKey: 'fed:fomc-oct:cut25',
      resolvesAt: at(22),
      fair: 0.62,
      venues: ['polymarket', 'kalshi', 'limitless'],
    },
    {
      nativeId: 'fed-oct-hold',
      title: 'Fed holds rates at the October FOMC',
      category: 'macro',
      eventKey: 'fed:fomc-oct:hold',
      resolvesAt: at(22),
      fair: 0.35,
      venues: ['polymarket', 'kalshi'],
    },
    {
      nativeId: 'cpi-sep-above-3',
      title: 'September CPI YoY prints at or above 3.0%',
      category: 'macro',
      eventKey: 'cpi:2026-09:gte3.0',
      resolvesAt: at(9),
      fair: 0.41,
      venues: ['kalshi', 'polymarket'],
    },
    {
      nativeId: 'us-recession-2026',
      title: 'NBER declares a US recession starting in 2026',
      category: 'macro',
      eventKey: 'macro:us-recession:2026',
      resolvesAt: at(86),
      fair: 0.18,
      venues: ['polymarket', 'kalshi'],
    },
    {
      nativeId: 'spx-above-7000-q4',
      title: 'S&P 500 closes above 7,000 on Dec 31',
      category: 'finance',
      eventKey: 'index:spx:gt7000:2026-12-31',
      resolvesAt: at(86),
      fair: 0.47,
      venues: ['kalshi', 'limitless', 'polymarket'],
    },
    {
      nativeId: 'nvda-beat-q3',
      title: 'Nvidia beats Q3 revenue consensus',
      category: 'finance',
      eventKey: 'earnings:nvda:q3-2026:beat',
      resolvesAt: at(44),
      fair: 0.78,
      venues: ['kalshi', 'polymarket'],
    },
    {
      nativeId: 'btc-ath-oct',
      title: 'Bitcoin sets a new all-time high in October',
      category: 'crypto',
      eventKey: 'crypto:btc:ath:2026-10',
      resolvesAt: at(25),
      fair: 0.33,
      venues: ['polymarket', 'limitless', 'kalshi'],
    },
    {
      nativeId: 'sol-etf-flows',
      title: 'Spot SOL ETFs see net inflows above $1B in Q4',
      category: 'crypto',
      eventKey: 'crypto:sol-etf:inflow-1b:q4',
      resolvesAt: at(86),
      fair: 0.29,
      venues: ['polymarket', 'limitless'],
    },
    {
      nativeId: 'uk-election-call',
      title: 'UK general election called before 2027',
      category: 'politics',
      eventKey: 'politics:uk:election-called:2026',
      resolvesAt: at(86),
      fair: 0.08,
      venues: ['polymarket'],
    },
    {
      nativeId: 'nba-opener-lakers',
      title: 'Lakers win their season opener',
      category: 'sports',
      eventKey: 'sports:nba:opener:lakers',
      resolvesAt: at(15),
      fair: 0.54,
      venues: ['kalshi', 'polymarket'],
    },
    {
      nativeId: 'gta6-delay',
      title: 'GTA VI release delayed again before year-end',
      category: 'culture',
      eventKey: 'culture:gta6:delay:2026',
      resolvesAt: at(86),
      fair: 0.22,
      venues: ['polymarket', 'kalshi'],
    },
  ];
}

/** Crypto venues also list the short-dated price markets HL lists; mirror them so they compare. */
export type Mirror = () => Promise<Market[]>;
const mirrored = async (
  mirror: Mirror | undefined,
  keep: (i: number) => boolean,
): Promise<Listing[]> =>
  ((await mirror?.().catch(() => [])) ?? [])
    .filter((m, i) => m.eventKey.startsWith('price:') && keep(i))
    .map((m) => ({
      nativeId: `px-${m.nativeId}`,
      title: m.title,
      category: m.category,
      eventKey: m.eventKey,
      resolvesAt: m.resolvesAt,
      fair: m.yes.mid,
    }));

const listingsFor =
  (venue: string, mirror?: Mirror, keep: (i: number) => boolean = () => false) =>
  async () => [
    ...sharedEvents()
      .filter((e) => e.venues.includes(venue))
      .map(({ venues: _v, ...l }) => ({
        ...l,
        nativeId: `${venue === 'kalshi' ? 'KX' : ''}${l.nativeId}`,
      })),
    ...(await mirrored(mirror, keep)),
  ];

const centsUp = (usd: number) => Math.ceil(usd * 100 - 1e-9) / 100;

export const PROFILES: Record<'polymarket' | 'kalshi' | 'limitless', SimProfile> = {
  // Most Polymarket markets charge no taker fee; tyr earns via builder attribution.
  polymarket: { halfSpread: 0.005, depth: 4_000, skew: 0.02, fee: () => 0 },
  // Kalshi's published formula: ceil(0.07 × C × P × (1 − P)) to the cent.
  kalshi: {
    halfSpread: 0.01,
    depth: 2_500,
    skew: 0.025,
    fee: (p, c) => centsUp(0.07 * c * p * (1 - p)),
  },
  // Limitless (Base): modeled flat taker fee.
  limitless: { halfSpread: 0.015, depth: 600, skew: 0.03, fee: (p, c) => 0.01 * p * c },
};

export function simulatedVenues(mirror?: Mirror, now?: () => number) {
  return [
    new SimulatedVenue(
      {
        id: 'polymarket',
        name: 'Polymarket',
        settlementChain: 'polygon',
        collateral: 'USDC',
        mode: 'simulated',
        revenue: 'builder program attribution on routed orders',
        minOrderUsd: 1,
      },
      PROFILES.polymarket,
      listingsFor('polymarket', mirror, (i) => i % 2 === 0),
      now,
    ),
    new SimulatedVenue(
      {
        id: 'kalshi',
        name: 'Kalshi (tokenized on Solana)',
        settlementChain: 'solana',
        collateral: 'USDC',
        mode: 'simulated',
        revenue: 'routing fee on Solana-tokenized Kalshi outcomes',
        minOrderUsd: 1,
      },
      PROFILES.kalshi,
      listingsFor('kalshi'),
      now,
    ),
    new SimulatedVenue(
      {
        id: 'limitless',
        name: 'Limitless',
        settlementChain: 'base',
        collateral: 'USDC',
        mode: 'simulated',
        revenue: 'referral fee on routed orders',
        minOrderUsd: 1,
      },
      PROFILES.limitless,
      listingsFor('limitless', mirror, (i) => i % 3 === 0),
      now,
    ),
  ];
}
