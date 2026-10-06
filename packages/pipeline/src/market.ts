// Solana-side market registration + commitments shared by bet and settlement.
import { randomBytes } from 'node:crypto';
import {
  amountCommitment,
  fetchMarket,
  registerMarketIx,
  sendAtomic,
  signerFromFile,
  treasury,
} from '@tyr/solana';

/** On-chain market id = solanaMarketId(venue market id); admin registers it on first use. */
export async function ensureMarketRegistered(id: bigint) {
  if (await fetchMarket(id)) return null;
  const admin = await signerFromFile(
    process.env.SOLANA_DEPLOYER_KEYPAIR ?? 'keys/solana-deployer.json',
  );
  return sendAtomic([await registerMarketIx(admin, id)], await treasury());
}

export function commit(amount: bigint, saltHex?: string) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(32);
  return { salt: salt.toString('hex'), commitment: amountCommitment(amount, salt) };
}

/** USD ↔ 6-dp base units (tyrUSD and AlphaUSD share 6 decimals). */
export const units = (usd: number) => BigInt(Math.floor(usd * 1e6 + 1e-6));
export const fromUnits = (u: bigint) => Number(u) / 1e6;

/** settle_position outcome codes (program stores a free u8). */
export const OUTCOME = { yes: 0, no: 1, closed: 2, refunded: 3 } as const;
