// PRD 9.1 geofence — Stop 9 decision: SELF-DECLARED region only (no IP geolocation; deviation in
// docs/human-values.md). Blocked set = the PRD default list. A user who never declared a region
// is not eligible: the hedge is opt-in, never assumed.
export const BLOCKED_REGIONS = ['US', 'CA', 'GB', 'CH', 'AE'] as const;

export const normalizeRegion = (r: string) => r.trim().toUpperCase();
export const isValidRegion = (r: string) => /^[A-Z]{2}$/.test(normalizeRegion(r));

export type Eligibility = { eligible: true } | { eligible: false; reason: string };

export function hedgeEligibility(region: string | null | undefined): Eligibility {
  if (!region) return { eligible: false, reason: 'declare your region to see hedges' };
  const r = normalizeRegion(region);
  if ((BLOCKED_REGIONS as readonly string[]).includes(r))
    return { eligible: false, reason: `stock-token hedges are not available in ${r}` };
  return { eligible: true };
}
