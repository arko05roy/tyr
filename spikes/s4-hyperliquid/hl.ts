// Shared helpers for spike S4 — seed of packages/hyperliquid.
export const HL_API = process.env.HL_API_URL ?? 'https://api.hyperliquid-testnet.xyz';
if (new URL(HL_API).host !== 'api.hyperliquid-testnet.xyz') throw new Error('S4 is testnet-only');

/** HIP-4 encoding per HL docs → Asset IDs → Outcomes. */
export const outcomeEncoding = (outcome: number, side: 0 | 1) => 10 * outcome + side;
export const outcomeCoin = (outcome: number, side: 0 | 1) => `#${outcomeEncoding(outcome, side)}`;
export const outcomeAssetId = (outcome: number, side: 0 | 1) =>
  100_000_000 + outcomeEncoding(outcome, side);

export async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${HL_API}/info`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`info ${body.type} → HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export type Outcome = {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: { name: string }[];
  quoteToken: string;
};
export type Level = { px: string; sz: string; n: number };
export type Book = { coin: string; levels: [Level[], Level[]] };

/** Parse `key:value|key:value` template descriptions (e.g. binaryPrice markets). */
export function parseTemplate(desc: string): Record<string, string> | null {
  if (!desc.includes('|') || !desc.includes(':')) return null;
  return Object.fromEntries(
    desc.split('|').map((kv) => [kv.slice(0, kv.indexOf(':')), kv.slice(kv.indexOf(':') + 1)]),
  );
}

/** `20261005-1500` → Date (UTC). */
export function templateTime(t: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(t);
  if (!m) throw new Error(`bad template time ${t}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!));
}

/** Outcomes whose YES book has both bids and asks right now. */
export async function liveOutcomes(limit = 10) {
  const meta = await info<{ outcomes: Outcome[] }>({ type: 'outcomeMeta' });
  const mids = await info<Record<string, string>>({ type: 'allMids' });
  const candidates = meta.outcomes
    .filter((o) => mids[outcomeCoin(o.outcome, 0)] !== undefined)
    .reverse();
  const live: { outcome: Outcome; book: Book }[] = [];
  for (const o of candidates) {
    if (live.length >= limit) break;
    const book = await info<Book>({ type: 'l2Book', coin: outcomeCoin(o.outcome, 0) });
    if (book.levels[0].length && book.levels[1].length) live.push({ outcome: o, book });
  }
  return { total: meta.outcomes.length, live };
}
