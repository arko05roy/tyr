// PRD 6 over HTTP — live: passkey signup → GET /api/deposits/addresses → real Robinhood testnet
// ETH to the EVM deposit address → POST /api/deposits/claim (on-chain verified, Chainlink-priced,
// credited on devnet) → GET /api/deposits shows it credited → GET /api/balance reflects it.
import { PrismaClient } from '@tyr/db';
import { evmClient, evmSource } from '@tyr/evm-deposits';
import { relyingParty } from '@tyr/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SoftAuthenticator } from '../../../packages/tempo/test/softAuthenticator.js';
import { buildApp } from '../src/app.js';

const db = new PrismaClient();
let base = '';
let close: () => Promise<void>;
let cookie = '';

beforeAll(async () => {
  const app = await buildApp({ db, cookieSecret: process.env.TYR_SECRETS_KEY ?? '' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = () => app.close();
});
afterAll(async () => {
  await close();
  await db.$disconnect();
});

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

describe('deposits API (live RH testnet → devnet)', () => {
  it('addresses → ETH deposit → claim → credited → balance', async () => {
    expect((await api('GET', '/api/deposits/addresses')).status).toBe(401);
    const rp = relyingParty();
    const auth = new SoftAuthenticator(rp.rpId, rp.origin);
    const opts = await api('POST', '/api/auth/passkey/register/options');
    expect(
      (await api('POST', '/api/auth/passkey/register/verify', auth.create(opts.json.challenge)))
        .status,
    ).toBe(200);

    const addrs = await api('GET', '/api/deposits/addresses');
    expect(addrs.status).toBe(200);
    expect(addrs.json.evm.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addrs.json.tempo.memo).toMatch(/^0x[0-9a-f]{64}$/);
    // stable across calls
    expect((await api('GET', '/api/deposits/addresses')).json).toEqual(addrs.json);

    const src = evmSource('robinhood');
    const wallet = createWalletClient({
      account: privateKeyToAccount(process.env.EVM_TEST_SENDER_KEY as Hex),
      chain: src.chain,
      transport: http(process.env.ROBINHOOD_RPC_URL),
    });
    const txHash = await wallet.sendTransaction({
      to: addrs.json.evm.address,
      value: parseEther('0.0005'),
    });
    console.log(`[evidence] api RH ETH deposit: ${txHash}`);
    await evmClient(src).waitForTransactionReceipt({ hash: txHash });

    expect(
      (await api('POST', '/api/deposits/claim', { chain: 'robinhood', txHash: 'nope' })).status,
    ).toBe(400);
    let claim;
    for (;;) {
      claim = await api('POST', '/api/deposits/claim', { chain: 'robinhood', txHash });
      if (claim.status !== 409) break;
      await new Promise((r) => setTimeout(r, 4_000));
    }
    expect(claim.status).toBe(201);
    expect(claim.json.deposits[0].status).toBe('credited');
    const usdAmount = Number(claim.json.deposits[0].amount);
    expect(usdAmount).toBeGreaterThan(0);

    const list = await api('GET', '/api/deposits');
    expect(list.json.deposits).toHaveLength(1);
    expect(list.json.deposits[0].sourceTx).toBe(txHash);
    expect((await api('GET', '/api/balance')).json.availableUsd).toBeCloseTo(usdAmount, 6);
  }, 300_000);
});
