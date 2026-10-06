// PRD Phase 9 gate — Flow D through HTTP on live testnets: passkey signup → geofence (no region /
// US → 403, DE → eligible) → $25 bet on a featured US500 market → hedge quote + open (real CT
// debit, simulated swap at the live xyz oracle) → close bet at mark → hedge worker closes the hedge
// (real CT credit) → combined bet + hedge receipt, hash-committed and anchored by a Tempo memo tx.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@tyr/db';
import { createExecutor, featuredMarkets } from '@tyr/hyperliquid';
import { confidentialAccount, settleOrder } from '@tyr/pipeline';
import { hedgeRule, hedgeWorker } from '@tyr/robinhood';
import { applyPending, ataOf, deposit, explorer, mintPublic } from '@tyr/solana';
import { chain, explorerTx, memo32, publicClient, relyingParty, rpcUrl, usd } from '@tyr/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, http, keccak256, publicActions, toHex, type Address, type Hex } from 'viem';
import { Account, Actions, withRelay } from 'viem/tempo';
import { SoftAuthenticator } from '../../../packages/tempo/test/softAuthenticator.js';
import { fund } from '../../../packages/tempo/test/helpers.js';
import { buildApp } from '../src/app.js';

const db = new PrismaClient();
const exec = createExecutor();
let base = '';
let close: () => Promise<void>;
let cookie = '';

beforeAll(async () => {
  const app = await buildApp({
    db,
    cookieSecret: process.env.TYR_SECRETS_KEY ?? '',
    executor: exec,
  });
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

const ev = (label: string, url: string) => console.log(`[evidence] ${label}: ${url}`);

const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

describe('e2e Flow D — Robinhood hedge (live Tempo + Solana devnet + HL testnet + RH testnet)', () => {
  it('geofence → bet → hedge → settle → combined receipt with Tempo memo', async () => {
    // 1. signup + $60/day loss limit
    const rp = relyingParty();
    const auth = new SoftAuthenticator(rp.rpId, rp.origin);
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
    const prep = await api('POST', '/api/limits/prepare', { amountUsd: 60, period: 'day' });
    const browser = createClient({
      account: passkey,
      chain,
      transport: withRelay(http(rpcUrl()), http(`${base}/api/tempo/sponsor`)),
    }).extend(publicActions);
    const authTx = await Actions.accessKey.authorize(browser, {
      accessKey: prep.json.accessKey,
      expiry: prep.json.expiry,
      limits: (prep.json.limits as { token: string; limit: string; period: number }[]).map((l) => ({
        ...l,
        limit: BigInt(l.limit),
      })),
      feePayer: true,
    } as never);
    await browser.waitForTransactionReceipt({ hash: authTx });
    expect(
      (await api('PUT', '/api/limits/confirm', { limitId: prep.json.limitId, txHash: authTx }))
        .status,
    ).toBe(200);

    // 2. fund: AlphaUSD for the stake leg, $80 confidential bankroll
    await fund(reg.json.tempoAddress as Address, usd(80));
    const user = await db.user.findUniqueOrThrow({
      where: { tempoAddress: reg.json.tempoAddress },
    });
    const keys = await confidentialAccount(db, user.id);
    await mintPublic(await ataOf(keys.owner.address), usd(80));
    await deposit(keys, usd(80));
    await applyPending(keys);
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(80);

    // 3. a featured market with a mapped hedge (US500 → AMZN proxy), tightest spread
    const markets = (await featuredMarkets()).filter((m) => hedgeRule(m));
    expect(markets.length).toBeGreaterThan(0);
    const m = markets.reduce((a, b) => (b.yes.bid / b.yes.ask > a.yes.bid / a.yes.ask ? b : a));

    // 4. geofence (PRD 9.1, self-declared region): undeclared → 403, US → 403, bad code → 400
    expect((await api('GET', `/api/hedge/markets/${m.outcome}`)).status).toBe(403);
    expect((await api('PUT', '/api/auth/region', { region: 'USA' })).status).toBe(400);
    const us = await api('PUT', '/api/auth/region', { region: 'us' });
    expect(us.json).toMatchObject({ region: 'US', hedge: { eligible: false } });
    const blocked = await api('GET', `/api/hedge/markets/${m.outcome}`);
    expect(blocked.status).toBe(403);
    expect(blocked.json.error).toMatch(/not available in US/);
    expect((await api('PUT', '/api/auth/region', { region: 'DE' })).json.hedge.eligible).toBe(true);
    const card = await api('GET', `/api/hedge/markets/${m.outcome}`);
    expect(card.json).toMatchObject({ offered: true, stock: 'AMZN', simulated: true });

    // 5. $25 YES bet
    const bet = await api('POST', '/api/bets', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 25,
      idempotencyKey: randomUUID(),
    });
    expect(bet.status).toBe(201);
    expect(Number(bet.json.filledSize)).toBeGreaterThan(0);
    const orderId = bet.json.id as string;
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(55);

    // 6. hedge: quote, over-stake rejected, US blocked server-side on POST too, then open $20
    const q = await api('GET', `/api/hedge/${orderId}/quote?amountUsd=20`);
    expect(q.status).toBe(200);
    expect(q.json).toMatchObject({
      stock: 'AMZN',
      direction: 'sell',
      simulated: true,
      amountInUsd: 20,
    });
    expect((await api('GET', `/api/hedge/${orderId}/quote?amountUsd=26`)).status).toBe(400);
    await api('PUT', '/api/auth/region', { region: 'US' });
    expect((await api('POST', '/api/hedge', { orderId, amountUsd: 20 })).status).toBe(403);
    await api('PUT', '/api/auth/region', { region: 'DE' });
    const opened = await api('POST', '/api/hedge', { orderId, amountUsd: 20 });
    expect(opened.status).toBe(201);
    expect(opened.json).toMatchObject({
      status: 'open',
      symbol: 'AMZN',
      direction: 'sell',
      simulated: true,
    });
    expect(opened.json.escrowTx).toBeTruthy();
    expect(opened.json.uniswapTx).toBeNull(); // simulated swap: no fake hash
    ev('hedge CT user→escrow', explorer(opened.json.escrowTx));
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(35);
    expect((await api('POST', '/api/hedge', { orderId, amountUsd: 5 })).status).toBe(404); // one per bet

    // 7. settle the bet (real close order), then the worker closes the hedge
    const s = await settleOrder(db, exec, orderId, { kind: 'close' });
    if (!s) throw new Error('close-at-mark did not fully unwind against the live book');
    expect(await hedgeWorker(db)()).toEqual([orderId]);

    const got = await api('GET', `/api/hedge/${orderId}`);
    expect(got.json.status).toBe('closed');
    const r = got.json.receipt;
    expect(r).toMatchObject({
      kind: 'bet+hedge',
      orderId,
      bet: { outcome: 'closed', tempoPayoutTx: s.tempoPayoutTx },
      hedge: { stock: 'AMZN', direction: 'sell', amountInUsd: 20, simulated: true },
    });
    expect(r.netPnlUsd).toBeCloseTo(r.bet.pnlUsd + r.hedge.pnlUsd, 6);
    const { id, payloadHash, tempoMemoTx, ...payload } = r;
    expect(keccak256(toHex(canonical(payload)))).toBe(payloadHash);

    // Tempo memo anchor: real tx, memo = keccak256("receipt:<id>")
    const anchor = await publicClient().getTransactionReceipt({ hash: tempoMemoTx as Hex });
    expect(anchor.status).toBe('success');
    expect(
      await db.payoutMemo.findUnique({ where: { settlementId: `receipt:${id}` } }),
    ).toMatchObject({
      memo: memo32(`receipt:${id}`),
      txHash: tempoMemoTx,
    });
    if (got.json.payTx) ev('hedge CT escrow→user', explorer(got.json.payTx));
    ev('combined receipt tempo memo', explorerTx(tempoMemoTx));
    expect((await api('GET', '/api/balance')).json.availableUsd).toBeCloseTo(
      35 + Number(s.payoutUsd) + Number(got.json.valueUsd),
      6,
    );
    expect(await hedgeWorker(db)()).toEqual([]); // idempotent
  }, 600_000);
});
