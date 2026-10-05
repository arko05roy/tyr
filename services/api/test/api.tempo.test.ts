// Live Moderato, through the real HTTP API: passkey signup → session → loss limit via sponsor relay.
import { PrismaClient } from '@tyr/db';
import { ALPHA_USD, chain, relyingParty, rpcUrl } from '@tyr/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, http, publicActions } from 'viem';
import { Account, Actions, withRelay } from 'viem/tempo';
import { SoftAuthenticator } from '../../../packages/tempo/test/softAuthenticator.js';
import { buildApp } from '../src/app.js';

const db = new PrismaClient();
let base = '';
let close: () => Promise<void>;

beforeAll(async () => {
  const cookieSecret = process.env.TYR_SECRETS_KEY;
  if (!cookieSecret) throw new Error('TYR_SECRETS_KEY not set');
  const app = await buildApp({ db, cookieSecret });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as { port: number };
  base = `http://127.0.0.1:${port}`;
  close = () => app.close();
});
afterAll(async () => {
  await close();
  await db.$disconnect();
});

let cookie = '';
async function api(method: string, path: string, body?: unknown) {
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
}

describe('API: passkey auth + loss limit (live Moderato)', () => {
  it('signs up with a passkey, sets a $20/day limit on-chain via the sponsor relay', async () => {
    const rp = relyingParty();
    const auth = new SoftAuthenticator(rp.rpId, rp.origin);

    expect((await api('GET', '/api/limits')).status).toBe(401);

    const opts = await api('POST', '/api/auth/passkey/register/options');
    const reg = await api(
      'POST',
      '/api/auth/passkey/register/verify',
      auth.create(opts.json.challenge),
    );
    expect(reg.status).toBe(200);
    const passkey = Account.fromHeadlessWebAuthn(auth.privateKey, {
      rpId: rp.rpId,
      origin: rp.origin,
    });
    expect(reg.json.tempoAddress).toBe(passkey.address);
    expect((await api('GET', '/api/auth/me')).json.tempoAddress).toBe(passkey.address);

    const prep = await api('POST', '/api/limits/prepare', { amountUsd: 20, period: 'day' });
    expect(prep.status).toBe(200);

    // "Browser": the passkey authorizes tyr's access key; fees sponsored through tyr's HTTP relay.
    const browser = createClient({
      account: passkey,
      chain,
      transport: withRelay(http(rpcUrl()), http(`${base}/api/tempo/sponsor`)),
    }).extend(publicActions);
    const txHash = await Actions.accessKey.authorize(browser, {
      accessKey: prep.json.accessKey,
      expiry: prep.json.expiry,
      limits: (prep.json.limits as { token: string; limit: string; period: number }[]).map((l) => ({
        ...l,
        limit: BigInt(l.limit),
      })),
      feePayer: true,
    } as never);
    expect((await browser.waitForTransactionReceipt({ hash: txHash })).status).toBe('success');
    console.log('authorize via API relay', `${chain.blockExplorers.default.url}/tx/${txHash}`);

    const conf = await api('PUT', '/api/limits/confirm', { limitId: prep.json.limitId, txHash });
    expect(conf.status).toBe(200);
    expect(conf.json.remainingUsd).toBe(20);

    const got = await api('GET', '/api/limits');
    expect(got.json.limit).toMatchObject({ period: 'day', amountUsd: 20, remainingUsd: 20 });
    expect(prep.json.limits[0].token).toBe(ALPHA_USD);
  });

  it("rejects confirm with someone else's tx", async () => {
    const prep = await api('POST', '/api/limits/prepare', { amountUsd: 5, period: 'day' });
    // a real Moderato tx not sent by this user (treasury faucet tx from Phase 1 evidence)
    const bad = await api('PUT', '/api/limits/confirm', {
      limitId: prep.json.limitId,
      txHash: '0xeb953cf4472ff19d06f964d4f97dfbc256735abcd1190aef5f4db4ffed836a82',
    });
    expect(bad.status).toBe(400);
  });
});
