// PRD 2.1 — WebAuthn passkey registration/login (server side) + Tempo address derivation.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { convertCOSEtoPKCS, isoBase64URL } from '@simplewebauthn/server/helpers';
import type { PrismaClient } from '@tyr/db';
import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem';

export type RelyingParty = { rpId: string; rpName: string; origin: string; origins: string[] };

export function relyingParty(): RelyingParty {
  // Comma-separated: the onboarding app (:3000) and the dashboard app (:3001) both sign in.
  const origins = (process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((o) => o.trim());
  return {
    rpId: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    rpName: 'tyr.bet',
    origin: origins[0]!,
    origins,
  };
}

/**
 * Tempo derives a P-256/WebAuthn account address like Ethereum does for secp256k1:
 * last 20 bytes of keccak256(x ‖ y). Matches viem/tempo `Account.fromHeadlessWebAuthn().address`.
 */
export function tempoAddressFromP256(uncompressed: Hex): Address {
  const bytes = uncompressed.slice(2);
  if (bytes.length !== 130 || !bytes.startsWith('04'))
    throw new Error('expected 0x04‖x‖y P-256 key');
  return getAddress(`0x${keccak256(`0x${bytes.slice(2)}`).slice(-40)}`);
}

const CHALLENGE_TTL_MS = 5 * 60_000;

async function consumeChallenge(
  db: PrismaClient,
  challenge: string,
  purpose: string,
): Promise<void> {
  const row = await db.authChallenge.findUnique({ where: { challenge } });
  if (!row || row.purpose !== purpose) throw new Error('unknown challenge');
  await db.authChallenge.delete({ where: { id: row.id } });
  if (Date.now() - row.createdAt.getTime() > CHALLENGE_TTL_MS) throw new Error('challenge expired');
}

function challengeOf(clientDataJSON: string): string {
  return (JSON.parse(isoBase64URL.toUTF8String(clientDataJSON)) as { challenge: string }).challenge;
}

export async function registrationOptions(db: PrismaClient, rp = relyingParty()) {
  const opts = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: `tyr-${Date.now().toString(36)}`, // no PII: passkey-only accounts
    attestationType: 'none',
    supportedAlgorithmIDs: [-7], // ES256 / P-256 — the curve Tempo verifies natively
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await db.authChallenge.create({ data: { challenge: opts.challenge, purpose: 'register' } });
  return opts;
}

export async function verifyRegistration(
  db: PrismaClient,
  response: RegistrationResponseJSON,
  rp = relyingParty(),
) {
  const challenge = challengeOf(response.response.clientDataJSON);
  await consumeChallenge(db, challenge, 'register');
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origins,
    expectedRPID: rp.rpId,
    requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) throw new Error('registration not verified');
  const { credential } = v.registrationInfo;
  const publicKey = toHex(convertCOSEtoPKCS(credential.publicKey));
  const tempoAddress = tempoAddressFromP256(publicKey);
  return db.user.create({
    data: {
      tempoAddress,
      passkeyCredentialId: credential.id,
      passkeyPublicKey: publicKey,
      passkeyCounter: credential.counter,
    },
  });
}

export async function loginOptions(db: PrismaClient, rp = relyingParty()) {
  const opts = await generateAuthenticationOptions({ rpID: rp.rpId, userVerification: 'required' });
  await db.authChallenge.create({ data: { challenge: opts.challenge, purpose: 'login' } });
  return opts;
}

export async function verifyLogin(
  db: PrismaClient,
  response: AuthenticationResponseJSON,
  rp = relyingParty(),
) {
  const challenge = challengeOf(response.response.clientDataJSON);
  await consumeChallenge(db, challenge, 'login');
  const user = await db.user.findUnique({ where: { passkeyCredentialId: response.id } });
  if (!user) throw new Error('unknown credential');
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origins,
    expectedRPID: rp.rpId,
    requireUserVerification: true,
    credential: {
      id: user.passkeyCredentialId,
      publicKey: cosePublicKeyFromPkcs(user.passkeyPublicKey as Hex),
      counter: user.passkeyCounter,
    },
  });
  if (!v.verified) throw new Error('login not verified');
  return db.user.update({
    where: { id: user.id },
    data: { passkeyCounter: v.authenticationInfo.newCounter },
  });
}

/** Re-encode a stored 0x04‖x‖y key as a COSE EC2 map for simplewebauthn's verifier. */
function cosePublicKeyFromPkcs(uncompressed: Hex): Uint8Array<ArrayBuffer> {
  const raw = Buffer.from(uncompressed.slice(2), 'hex');
  const x = raw.subarray(1, 33);
  const y = raw.subarray(33, 65);
  // CBOR map(5): 1:2 (kty EC2), 3:-7 (ES256), -1:1 (P-256), -2:x, -3:y
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      x,
      Buffer.from([0x22, 0x58, 0x20]),
      y,
    ]),
  );
}
