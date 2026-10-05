import { createHash, createHmac, randomBytes } from 'node:crypto';
import { ConfidentialKeys, type AeKey, type ElGamalKeypair } from '@solana/zk-sdk';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressDecoder,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { open, seal } from '@tyr/core';

/**
 * Server-derived custody (owner-approved, PRD 3.2 / Appendix B): each user has one random
 * 32-byte secret, sealed with TYR_SECRETS_KEY and stored as `ConfidentialAccount.aeKeyRef`.
 * Everything else — the Solana owner key and the ElGamal + AE keys — is derived from it.
 */
export type UserKeys = {
  owner: KeyPairSigner;
  elgamal: ElGamalKeypair;
  ae: AeKey;
};

export function newUserSecret(): string {
  return seal(randomBytes(32).toString('hex'));
}

export async function keysFromIkm(ikm: Uint8Array): Promise<UserKeys> {
  const ownerSeed = createHash('sha256').update('tyr/solana-owner/v1').update(ikm).digest();
  const ck = ConfidentialKeys.fromIkm(ikm);
  return {
    owner: await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(ownerSeed)),
    elgamal: ck.elgamal(),
    ae: ck.ae(),
  };
}

export function userKeys(sealedSecret: string): Promise<UserKeys> {
  return keysFromIkm(Buffer.from(open(sealedSecret), 'hex'));
}

function masterKey(): Buffer {
  const k = process.env.TYR_SECRETS_KEY;
  if (!k || !/^[0-9a-f]{64}$/i.test(k)) throw new Error('TYR_SECRETS_KEY must be 64 hex chars');
  return Buffer.from(k, 'hex');
}

/** tyr escrow (receives bet stakes, pays winnings) — derived from the backend master key. */
export function escrowKeys(): Promise<UserKeys> {
  return keysFromIkm(createHmac('sha256', masterKey()).update('tyr/solana-escrow/v1').digest());
}

/**
 * Compliance auditor key (owner decision: auditor ENABLED). Separate secret so it can be
 * handed to a compliance holder without the backend master key.
 */
export function auditorKeys(): ElGamalKeypair {
  const s = process.env.SOLANA_AUDITOR_SEED;
  if (!s || !/^[0-9a-f]{64}$/i.test(s)) throw new Error('SOLANA_AUDITOR_SEED must be 64 hex chars');
  return ConfidentialKeys.fromIkm(Buffer.from(s, 'hex')).elgamal();
}

/** ElGamal pubkeys travel through Token-2022 as base58 "addresses" (32 bytes). */
export const elgamalAddress = (kp: ElGamalKeypair): Address =>
  getAddressDecoder().decode(kp.pubkey().toBytes());
