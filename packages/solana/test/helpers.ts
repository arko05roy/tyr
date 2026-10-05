import { randomBytes } from 'node:crypto';
import {
  applyPending,
  ataOf,
  balance,
  createConfidentialAccount,
  deposit,
  escrowKeys,
  explorer,
  keysFromIkm,
  mintPublic,
} from '../src/index.js';

/** A fresh, real devnet user: random secret → CT account configured on tyrUSD. */
export async function newFundedUser(publicAmount: bigint, confidential: bigint) {
  const keys = await keysFromIkm(randomBytes(32));
  const created = await createConfidentialAccount(keys);
  const token = await ataOf(keys.owner.address);
  const sigs = [...created.sigs];
  if (publicAmount > 0n) sigs.push(await mintPublic(token, publicAmount));
  if (confidential > 0n) {
    sigs.push(await deposit(keys, confidential));
    sigs.push(await applyPending(keys));
  }
  return { keys, token, sigs };
}

export async function escrow() {
  const keys = await escrowKeys();
  await createConfidentialAccount(keys); // no-op if it exists
  // Shared account across suites: settle any pending credits so balance deltas are exact.
  if ((await balance(keys)).pendingBalance > 0n) await applyPending(keys);
  return keys;
}

export const log = (label: string, sigs: string[]) => {
  for (const s of sigs) console.log(`[evidence] ${label}: ${explorer(s)}`);
};

export const usd = (n: number) => BigInt(Math.round(n * 1e6));
