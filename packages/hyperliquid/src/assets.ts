// HIP-4 outcome encoding (HL docs → Asset IDs → Outcomes) + template description parsing.

export type OutcomeSide = 0 | 1; // 0 = YES, 1 = NO

export const outcomeEncoding = (outcome: number, side: OutcomeSide) => 10 * outcome + side;
export const outcomeCoin = (outcome: number, side: OutcomeSide) =>
  `#${outcomeEncoding(outcome, side)}`;
export const outcomeAssetId = (outcome: number, side: OutcomeSide) =>
  100_000_000 + outcomeEncoding(outcome, side);

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
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

/**
 * When the market stops trading: `time` for price templates, `resolutionDeadline` for sports.
 * null if the description carries no machine-readable deadline.
 */
export function resolvesAt(description: string): Date | null {
  const t = parseTemplate(description);
  const raw = t?.time ?? t?.resolutionDeadline;
  if (!raw) return null;
  try {
    return templateTime(raw);
  } catch {
    return null;
  }
}
