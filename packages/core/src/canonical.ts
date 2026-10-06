/**
 * Canonical JSON: object keys sorted recursively, no whitespace. Receipt hashes (PRD 10.1) are
 * keccak256 over this string, so anyone holding the payload can recompute them.
 */
export const canonicalJson = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonicalJson).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
