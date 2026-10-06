// PRD 9.3 price read. Owner-approved deviation (2026-10-05): no Chainlink feed exists on RH testnet,
// so the price comes from the Hyperliquid testnet `xyz` HIP-3 dex for the same stock. We use the
// deployer-pushed `oraclePx` (the closest analog to a Chainlink answer — the xyz books are
// one-sided on testnet, so a book mid doesn't exist). HL exposes no oracle timestamp, so the
// stale/garbage check is: oracle present and positive, and within MAX_ORACLE_MARK_DEVIATION of
// the mark price; the reading is fetched per call and timestamped at fetch.
import { info } from '@tyr/hyperliquid';
import type { StockSymbol } from './chain.js';

export const MAX_ORACLE_MARK_DEVIATION = 0.25;

export class StalePriceError extends Error {}

export type StockPrice = {
  symbol: StockSymbol;
  px: number;
  markPx: number;
  at: Date;
  source: string;
};

type AssetCtx = { oraclePx: string | null; markPx: string | null };

export async function stockPrice(symbol: StockSymbol): Promise<StockPrice> {
  const coin = `xyz:${symbol}`;
  const [meta, ctxs] = await info<[{ universe: { name: string }[] }, AssetCtx[]]>({
    type: 'metaAndAssetCtxs',
    dex: 'xyz',
  });
  const ctx = ctxs[meta.universe.findIndex((u) => u.name === coin)];
  return checkPrice(symbol, ctx, new Date());
}

/** Validates one oracle reading (exported for the rejection test). */
export function checkPrice(symbol: StockSymbol, ctx: AssetCtx | undefined, at: Date): StockPrice {
  const coin = `xyz:${symbol}`;
  const px = Number(ctx?.oraclePx);
  const markPx = Number(ctx?.markPx);
  if (!(px > 0) || !(markPx > 0)) throw new StalePriceError(`no oracle/mark price for ${coin}`);
  const dev = Math.abs(px - markPx) / markPx;
  if (dev > MAX_ORACLE_MARK_DEVIATION)
    throw new StalePriceError(
      `${coin} oracle ${px} deviates ${(dev * 100).toFixed(1)}% from mark ${markPx}`,
    );
  return { symbol, px, markPx, at, source: `hyperliquid-testnet xyz oraclePx ${coin}` };
}
