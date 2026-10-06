// Shared live setup for the Phase 8 suites: API server, passkey owner, capped agent session.
import { PrismaClient } from '@tyr/db';
import type { Executor } from '@tyr/hyperliquid';
import { chain, relyingParty, rpcUrl, signAgentRequest } from '@tyr/tempo';
import { createClient, http, publicActions, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Account, Actions, withRelay } from 'viem/tempo';
import { SoftAuthenticator } from '../../../packages/tempo/test/softAuthenticator.js';
import { buildApp } from '../src/app.js';

export const db = new PrismaClient();

export async function startApi(executor?: Executor) {
  const app = await buildApp({
    db,
    cookieSecret: process.env.TYR_SECRETS_KEY ?? '',
    ...(executor ? { executor } : {}),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  return { base, close: () => app.close() };
}

/** Cookie-session HTTP client for the owner. */
export function ownerApi(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0] ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON in assertions
    return { status: res.status, json: (await res.json()) as any };
  };
}

/** Signed agent request without payment handling. */
export async function agentCall(
  base: string,
  key: Hex,
  method: string,
  path: string,
  body?: unknown,
) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(await signAgentRequest(privateKeyToAccount(key), {
        method,
        path,
        ...(raw ? { body: raw } : {}),
      })),
      ...(raw ? { 'content-type': 'application/json' } : {}),
    },
    ...(raw ? { body: raw } : {}),
  });
  return {
    status: res.status,
    headers: res.headers,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON in assertions
    json: (await res.json().catch(() => null)) as any,
  };
}

/** Passkey signup → owner authorizes a fresh agent key with `capUsd` on-chain → confirm. */
export async function ownerWithAgent(base: string, capUsd: number) {
  const api = ownerApi(base);
  const rp = relyingParty();
  const auth = new SoftAuthenticator(rp.rpId, rp.origin);
  const opts = await api('POST', '/api/auth/passkey/register/options');
  const reg = await api(
    'POST',
    '/api/auth/passkey/register/verify',
    auth.create(opts.json.challenge),
  );
  if (reg.status !== 200) throw new Error(`register failed: ${JSON.stringify(reg.json)}`);
  const passkey = Account.fromHeadlessWebAuthn(auth.privateKey, {
    rpId: rp.rpId,
    origin: rp.origin,
  });

  const agentKey = generatePrivateKey();
  const created = await api('POST', '/api/agent/sessions', {
    agentAddress: privateKeyToAccount(agentKey).address,
    capUsd,
    period: 'day',
    name: 'test agent',
  });
  if (created.status !== 201) throw new Error(`session failed: ${JSON.stringify(created.json)}`);

  const browser = createClient({
    account: passkey,
    chain,
    transport: withRelay(http(rpcUrl()), http(`${base}/api/tempo/sponsor`)),
  }).extend(publicActions);
  const authTx = await Actions.accessKey.authorize(browser, {
    accessKey: created.json.accessKey,
    expiry: created.json.expiry,
    limits: (created.json.limits as { token: string; limit: string; period: number }[]).map(
      (l) => ({
        ...l,
        limit: BigInt(l.limit),
      }),
    ),
    feePayer: true,
  } as never);
  await browser.waitForTransactionReceipt({ hash: authTx });
  const confirmed = await api('PUT', `/api/agent/sessions/${created.json.sessionId}/confirm`, {
    txHash: authTx,
  });
  if (confirmed.status !== 200)
    throw new Error(`confirm failed: ${JSON.stringify(confirmed.json)}`);

  return {
    api,
    agentKey,
    authTx: authTx as Hex,
    sessionId: created.json.sessionId as string,
    tempoAddress: reg.json.tempoAddress as `0x${string}`,
  };
}
