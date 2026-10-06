// PRD 7.3 — ZIP-321 payment request: zcash:<UA>?amount=<ZEC>&memo=<base64url(memo bytes)>.
// The frontend renders this URI as a QR; the user's wallet pays it as-is.
export const ZAT_PER_ZEC = 100_000_000n;

export function formatZec(zat: bigint): string {
  const whole = zat / ZAT_PER_ZEC;
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function paymentUri(to: string, zat: bigint, memo: string): string {
  if (zat <= 0n) throw new Error('amount must be positive');
  const m = Buffer.from(memo, 'utf8');
  if (m.length > 512) throw new Error('memo exceeds 512 bytes');
  return `zcash:${to}?amount=${formatZec(zat)}&memo=${m.toString('base64url')}`;
}
