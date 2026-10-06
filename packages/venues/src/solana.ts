// On-chain market id for the Solana settlement program (u64). HL keeps its outcome id so existing
// positions stay valid; other venues hash into the upper half of the u64 space (top bit set), which
// HL outcome ids never reach.
import { createHash } from 'node:crypto';
import { parseMarketId } from './types.js';

export function solanaMarketId(id: string): bigint {
  const { venue, nativeId } = parseMarketId(id);
  if (venue === 'hyperliquid') return BigInt(nativeId);
  const h = createHash('sha256').update(id).digest().readBigUInt64BE(0);
  return h | (1n << 63n);
}
