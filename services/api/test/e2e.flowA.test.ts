// PRD Phase 5 gate — Flow A end-to-end through HTTP, on live testnets:
// passkey signup → $60/day limit → fund confidential bankroll (devnet) → $25 bet on a featured HL
// market → Tempo stake + CT escrow + Position PDA + HL fill → close at mark (real close order)
// → settle_position + CT payout + Tempo memo payout. Below-$10 bet → 400. No-fill bet (maxPrice
// under the live ask) → refunded on every leg. Over-limit bet → 402. Replay → same order.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@tyr/db';
import { createExecutor, featuredMarkets } from '@tyr/hyperliquid';
import { confidentialAccount, settleOrder } from '@tyr/pipeline';
import {
  applyPending,
  ataOf,
  deposit,
  explorer,
  fetchPosition,
  mintPublic,
  orderId32,
} from '@tyr/solana';
import { chain, explorerTx, publicClient, relyingParty, rpcUrl, usd } from '@tyr/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, http, publicActions, type Address, type Hex } from 'viem';
import { Account, Actions, withRelay } from 'viem/tempo';
import WebSocket from 'ws';
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

describe('e2e Flow A (live Tempo + Solana devnet + HL testnet)', () => {
  it('bet → fill → close at mark → settle → Tempo memo payout; over-limit → 402', async () => {
    // 1. passkey signup + $60/day loss limit authorized on-chain (fees sponsored by tyr)
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
    ev('limit authorized', explorerTx(authTx));

    // 2. fund: AlphaUSD for stake authorizations; confidential tyrUSD bankroll on devnet
    //    (treasury mint stands in for Phase 6 deposits)
    await fund(reg.json.tempoAddress as Address, usd(80));
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(0);
    const user = await db.user.findUniqueOrThrow({
      where: { tempoAddress: reg.json.tempoAddress },
    });
    const keys = await confidentialAccount(db, user.id);
    await mintPublic(await ataOf(keys.owner.address), usd(80));
    await deposit(keys, usd(80));
    await applyPending(keys);
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(80);

    // live event stream
    const events: { type: string; step?: string }[] = [];
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } });
    ws.on('message', (m) => events.push(JSON.parse(String(m))));
    await new Promise((ok) => ws.once('message', ok));

    // 3. $25 bet on the featured market with the tightest relative spread, so the later
    //    close-at-mark is itself above HL's $10 minimum order value
    const markets = await featuredMarkets();
    const m = markets.reduce((a, b) => (b.yes.bid / b.yes.ask > a.yes.bid / a.yes.ask ? b : a));
    const small = await api('POST', '/api/bets', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 2,
      idempotencyKey: randomUUID(),
    });
    expect(small.status).toBe(400);
    expect(small.json.error).toMatch(/minimum order is \$10/);
    const key = randomUUID();
    const bet = await api('POST', '/api/bets', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 25,
      idempotencyKey: key,
    });
    console.log(JSON.stringify(bet.json, null, 1).slice(0, 1500));
    expect(bet.status).toBe(201);
    expect(bet.json.step).toBe('executed');
    expect(Number(bet.json.filledSize)).toBeGreaterThan(0);
    expect(bet.json.simulated).toBe(exec.mode === 'paper');
    const orderId = bet.json.id as string;

    // Tempo stake leg landed; Solana position PDA open with no plaintext size
    const stakeRcpt = await publicClient().getTransactionReceipt({
      hash: bet.json.tempoStakeTx as Hex,
    });
    expect(stakeRcpt.status).toBe('success');
    const pos = await fetchPosition(keys.owner.address, orderId32(orderId));
    expect(pos?.status).toBe('open');
    ev('tempo stake', explorerTx(bet.json.tempoStakeTx));
    ev('CT user→escrow', explorer(bet.json.escrowTx));
    ev('open_position', explorer(bet.json.solanaOpenTx));
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(55);

    // idempotent replay: same order, no new chain writes
    const replay = await api('POST', '/api/bets', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 25,
      idempotencyKey: key,
    });
    expect(replay.json.id).toBe(orderId);
    expect(replay.json.tempoStakeTx).toBe(bet.json.tempoStakeTx);

    // 4. settle by closing at mark with a real close order against the live bid book
    const s = await settleOrder(db, exec, orderId, { kind: 'close' });
    if (!s) throw new Error('close-at-mark did not fully unwind against the live book');
    expect(s.outcome).toBe('closed');
    expect((await fetchPosition(keys.owner.address, orderId32(orderId)))?.status).toBe('settled');
    const payoutRcpt = await publicClient().getTransactionReceipt({ hash: s.tempoPayoutTx as Hex });
    expect(payoutRcpt.status).toBe('success');
    expect(await db.payoutMemo.findUnique({ where: { settlementId: orderId } })).toMatchObject({
      memo: s.memoHash,
      txHash: s.tempoPayoutTx,
    });
    ev('settle_position', explorer(s.solanaTx ?? ''));
    if (s.escrowPayTx) ev('CT escrow→user', explorer(s.escrowPayTx));
    ev('tempo memo payout', explorerTx(s.tempoPayoutTx as Hex));
    const after = (await api('GET', '/api/balance')).json.availableUsd;
    expect(after).toBeCloseTo(55 + Number(s.payoutUsd), 6);
    if (s.escrowTopUpTx) ev('house top-up into escrow', explorer(s.escrowTopUpTx));

    const got = await api('GET', `/api/bets/${orderId}`);
    expect(got.json).toMatchObject({ status: 'settled', settlement: { outcome: 'closed' } });

    // 5. compensation: maxPrice below every live ask → HL fills nothing → refund on every leg
    const refundKey = randomUUID();
    const nofill = await api('POST', '/api/bets', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 11,
      maxPrice: 0.001,
      idempotencyKey: refundKey,
    });
    expect(nofill.status).toBe(201);
    expect(nofill.json).toMatchObject({ status: 'refunded', step: 'settled', filledSize: '0' });
    expect(nofill.json.error).toMatch(/no fill on Hyperliquid/);
    expect(nofill.json.settlement).toMatchObject({ outcome: 'refunded', payoutUsd: '11' });
    const refundPos = await fetchPosition(keys.owner.address, orderId32(nofill.json.id));
    expect(refundPos?.status).toBe('settled');
    expect(refundPos?.outcome).toBe(3);
    const refundRcpt = await publicClient().getTransactionReceipt({
      hash: nofill.json.settlement.tempoPayoutTx as Hex,
    });
    expect(refundRcpt.status).toBe('success');
    expect((await api('GET', '/api/balance')).json.availableUsd).toBeCloseTo(after, 6);
    ev('refund: CT escrow→user', explorer(nofill.json.settlement.escrowPayTx));
    ev('refund: tempo memo payout', explorerTx(nofill.json.settlement.tempoPayoutTx));

    // The loss limit counts gross stakes: Tempo refunds credit the balance but the access-key
    // spend allowance stays consumed (enforced by the chain, not tyr) — 60 − 25 − 11 = 24 left.
    expect((await api('GET', '/api/limits')).json.limit.remainingUsd).toBe(24);

    // 6. over-limit: a $25 stake reverts on-chain → 402
    const over = await api('POST', '/api/bets', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 25,
      idempotencyKey: randomUUID(),
    });
    expect(over.status).toBe(402);
    expect(over.json.error).toMatch(/SpendingLimitExceeded/);
    expect((await api('GET', '/api/balance')).json.availableUsd).toBeCloseTo(after, 6); // no debit

    ws.close();
    const steps = events.filter((e) => e.type === 'order').map((e) => e.step);
    expect(steps).toEqual(
      expect.arrayContaining(['staked', 'escrowed', 'opened', 'executed', 'blocked']),
    );
    expect(events.some((e) => e.type === 'settlement')).toBe(true);
  }, 600_000);
});
