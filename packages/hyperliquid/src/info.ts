// PRD 4.1: read-only HL testnet info client (POST /info).
import { outcomeCoin, parseTemplate, resolvesAt, type OutcomeSide } from './assets.js';

const TESTNET_HOST = 'api.hyperliquid-testnet.xyz';

export function hlApiUrl(): string {
  const url = process.env.HL_API_URL ?? `https://${TESTNET_HOST}`;
  if (new URL(url).host !== TESTNET_HOST) throw new Error(`HL_API_URL must be testnet: ${url}`);
  return url;
}

export async function info<T>(body: Record<string, unknown>): Promise<T> {
  // HL rate-limits by weight per IP; back off on 429 instead of failing the caller.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${hlApiUrl()}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`info ${body.type} → HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }
}

/** map with at most `n` requests in flight. */
async function pooled<A, B>(xs: A[], n: number, fn: (x: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(xs.length);
  let i = 0;
  const worker = async () => {
    for (let k = i++; k < xs.length; k = i++) out[k] = await fn(xs[k] as A);
  };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, worker));
  return out;
}

export type Outcome = {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: { name: string }[];
  quoteToken: string;
  venue?: string;
};
export type Level = { px: string; sz: string; n: number };
export type Book = { coin: string; time: number; levels: [Level[], Level[]] };
export type Fill = {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  oid: number;
  hash: string;
  fee: string;
  builderFee?: string;
};

export const meta = () => info<{ universe: { name: string }[] }>({ type: 'meta' });
export const spotMeta = () =>
  info<{ tokens: unknown[]; universe: unknown[] }>({ type: 'spotMeta' });
export const outcomeMeta = () => info<{ outcomes: Outcome[] }>({ type: 'outcomeMeta' });
export const allMids = () => info<Record<string, string>>({ type: 'allMids' });
export const l2Book = (coin: string) => info<Book>({ type: 'l2Book', coin });
export const userFills = (user: string) => info<Fill[]>({ type: 'userFills', user });
export const orderStatus = (user: string, oid: number) =>
  info<{ status: string; order?: { status: string } }>({ type: 'orderStatus', user, oid });
/** Builder rewards accrue to the builder's referral state (HL docs → Builder codes). */
export const referral = (user: string) =>
  info<{ builderRewards?: string; unclaimedRewards?: string }>({ type: 'referral', user });

export type Market = {
  outcome: number;
  name: string;
  description: string;
  template: Record<string, string> | null;
  sides: string[];
  resolvesAt: string;
  yes: { coin: string; bid: number; ask: number; mid: number };
};

const toMarket = (o: Outcome, book: Book, at: Date, best: [Level, Level]): Market => {
  const bid = Number(best[0].px);
  const ask = Number(best[1].px);
  return {
    outcome: o.outcome,
    name: o.name,
    description: o.description,
    template: parseTemplate(o.description),
    sides: o.sideSpecs.map((s) => s.name.replace(/^template:/, '')),
    resolvesAt: at.toISOString(),
    yes: { coin: book.coin, bid, ask, mid: (bid + ask) / 2 },
  };
};

/**
 * Featured markets (Stop 4 decision: automatic): outcomes whose deadline is in the future
 * and whose YES book is two-sided right now. Live testnet data, refreshed on every call.
 */
export async function featuredMarkets(now = new Date()): Promise<Market[]> {
  const [{ outcomes }, mids] = await Promise.all([outcomeMeta(), allMids()]);
  const candidates = outcomes
    .map((o) => ({ o, at: resolvesAt(o.description) }))
    .filter(
      (c): c is { o: Outcome; at: Date } =>
        c.at !== null && c.at > now && mids[outcomeCoin(c.o.outcome, 0)] !== undefined,
    );
  const books = await pooled(candidates, 4, (c) => l2Book(outcomeCoin(c.o.outcome, 0)));
  return candidates
    .flatMap((c, i) => {
      const book = books[i];
      const [bid, ask] = [book?.levels[0][0], book?.levels[1][0]];
      return book && bid && ask ? [toMarket(c.o, book, c.at, [bid, ask])] : [];
    })
    .sort((a, b) => a.resolvesAt.localeCompare(b.resolvesAt));
}

export async function market(outcome: number) {
  const { outcomes } = await outcomeMeta();
  const o = outcomes.find((x) => x.outcome === outcome);
  if (!o) return null;
  const [yes, no] = await Promise.all([
    l2Book(outcomeCoin(outcome, 0)),
    l2Book(outcomeCoin(outcome, 1)),
  ]);
  return {
    outcome: o,
    resolvesAt: resolvesAt(o.description)?.toISOString() ?? null,
    books: { yes, no },
  };
}

export const bookFor = (outcome: number, side: OutcomeSide) => l2Book(outcomeCoin(outcome, side));
