// HUMAN STOP 7: ZEC/USD from a public price API (CoinGecko simple price, read-only). The rate used
// for each order is persisted on ZcashOrder so entry and payout conversions are reproducible.
export type ZecUsd = { usd: number; source: string; at: Date };

const URL_ =
  process.env.ZEC_USD_URL ??
  'https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd';
const TTL_MS = 60_000;
let cached: ZecUsd | undefined;

export async function zecUsd(): Promise<ZecUsd> {
  if (cached && Date.now() - cached.at.getTime() < TTL_MS) return cached;
  const r = await fetch(URL_, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`ZEC/USD price API ${r.status}`);
  const usd = Number(((await r.json()) as { zcash?: { usd?: number } }).zcash?.usd);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`ZEC/USD price API returned ${usd}`);
  cached = { usd, source: 'coingecko:simple/price', at: new Date() };
  return cached;
}

/** USD (decimal) → zatoshis at `usd` per ZEC, rounded up so the stake is always covered. */
export const usdToZatCeil = (usdAmount: number, rate: number) =>
  BigInt(Math.ceil((usdAmount / rate) * 1e8 - 1e-6));
/** USD → zatoshis, rounded down (payouts never exceed the converted amount). */
export const usdToZatFloor = (usdAmount: number, rate: number) =>
  BigInt(Math.floor((usdAmount / rate) * 1e8 + 1e-6));
