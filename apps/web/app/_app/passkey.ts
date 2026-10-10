"use client";
// The two places the browser touches a chain (PRD 12 rule): the passkey signs WebAuthn
// ceremonies, and it signs Tempo access-key authorizations (loss limit, agent cap).
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { createClient, http, publicActions } from "viem";
import { tempoModerato } from "viem/chains";
import { Account, Actions, withRelay } from "viem/tempo";
import { api, ok } from "./api";

const ALPHA_USD = "0x20c0000000000000000000000000000000000001" as const;
const chain = tempoModerato.extend({ feeToken: ALPHA_USD });

export async function signUp() {
  const options = await ok(api.POST("/api/auth/passkey/register/options"));
  const response = await startRegistration({ optionsJSON: options as never });
  return ok(api.POST("/api/auth/passkey/register/verify", { body: response as never }));
}

export async function signIn() {
  const options = await ok(api.POST("/api/auth/passkey/login/options"));
  const response = await startAuthentication({ optionsJSON: options as never });
  return ok(api.POST("/api/auth/passkey/login/verify", { body: response as never }));
}

type Grant = {
  accessKey: { accessKeyAddress: string; keyType: "p256" | "secp256k1" };
  expiry: number;
  limits: { token: string; limit: string; period: number }[];
};

/**
 * Passkey signs Actions.accessKey.authorize on Moderato; tyr's relay pays the fee.
 * Returns the tx hash once mined — the API then re-checks it on-chain.
 */
export async function authorizeAccessKey(grant: Grant): Promise<`0x${string}`> {
  // Mock API (no backend): nothing on-chain to authorize, hand back a fake tx hash.
  if (process.env.NEXT_PUBLIC_TYR_MOCK) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  const me = await ok(api.GET("/api/auth/me"));
  const account = Account.fromWebAuthnP256(
    { id: me.passkey.credentialId, publicKey: me.passkey.publicKey as `0x${string}` },
    { rpId: location.hostname },
  );
  const client = createClient({
    account,
    chain,
    transport: withRelay(
      http(process.env.NEXT_PUBLIC_TEMPO_RPC_URL ?? chain.rpcUrls.default.http[0]),
      http(`${location.origin}/api/tempo/sponsor`),
    ),
  }).extend(publicActions);
  const hash = await Actions.accessKey.authorize(client, {
    accessKey: grant.accessKey,
    expiry: grant.expiry,
    limits: grant.limits.map((l) => ({ ...l, limit: BigInt(l.limit) })),
    feePayer: true,
  } as never);
  await client.waitForTransactionReceipt({ hash });
  return hash;
}
