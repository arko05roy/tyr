// PRD Phase 11b.8 gate — bets on non-HL venues through the same Flow A saga, on live testnets:
// passkey signup → $100/day limit → fund bankroll → $20 bet on a Kalshi market by marketId →
// real Tempo stake + CT escrow + Position PDA (venue market id hashed into u64) + simulated venue
// fill → close at mark (simulated sell) → real settle_position + CT payout + Tempo memo payout.
// Then a $40 routed bet on a multi-venue event: one full saga per leg, all sharing routeKey.
// Venue fills are simulated (owner-approved); every chain leg is real.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@tyr/db';
import { createExecutor } from '@tyr/hyperliquid';
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

describe('e2e venue bets (live Tempo + Solana devnet, simulated venue fills)', () => {
  it('Kalshi bet by marketId and a routed multi-venue bet settle on every chain leg', async () => {
    // 1. passkey signup + $100/day loss limit
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
    const prep = await api('POST', '/api/limits/prepare', { amountUsd: 100, period: 'day' });
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

    // 2. fund AlphaUSD (stake authorizations) + confidential tyrUSD bankroll
    await fund(reg.json.tempoAddress as Address, usd(100));
    const user = await db.user.findUniqueOrThrow({
      where: { tempoAddress: reg.json.tempoAddress },
    });
    const keys = await confidentialAccount(db, user.id);
    await mintPublic(await ataOf(keys.owner.address), usd(100));
    await deposit(keys, usd(100));
    await applyPending(keys);
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(100);

    // 3. single-venue bet by marketId (Kalshi, simulated adapter)
    const kalshi = (await api('GET', '/api/venues/markets?venue=kalshi')).json.markets[0];
    expect(kalshi).toBeTruthy();
    const bet = await api('POST', '/api/bets', {
      marketId: kalshi.id,
      side: 'yes',
      stakeUsd: 20,
      idempotencyKey: randomUUID(),
    });
    console.log(JSON.stringify(bet.json, null, 1).slice(0, 1200));
    expect(bet.status).toBe(201);
    expect(bet.json).toMatchObject({
      marketId: kalshi.id,
      hlMarket: null,
      step: 'executed',
      simulated: true,
      hlOid: null,
    });
    expect(Number(bet.json.filledSize)).toBeGreaterThan(0);
    expect(Number(bet.json.builderFee)).toBeGreaterThan(0); // Kalshi taker fee
    const stakeRcpt = await publicClient().getTransactionReceipt({
      hash: bet.json.tempoStakeTx as Hex,
    });
    expect(stakeRcpt.status).toBe('success');
    expect((await fetchPosition(keys.owner.address, orderId32(bet.json.id)))?.status).toBe('open');
    ev('kalshi: tempo stake', explorerTx(bet.json.tempoStakeTx));
    ev('kalshi: CT user→escrow', explorer(bet.json.escrowTx));
    ev('kalshi: open_position', explorer(bet.json.solanaOpenTx));
    expect((await api('GET', '/api/balance')).json.availableUsd).toBe(80);

    // close at mark through the venue adapter, settle every chain leg
    const s = await settleOrder(db, exec, bet.json.id, { kind: 'close' });
    if (!s) throw new Error('close-at-mark did not fully unwind');
    expect(s.outcome).toBe('closed');
    const closes = await db.order.findMany({ where: { parentId: bet.json.id } });
    expect(closes.every((c) => c.marketId === kalshi.id && !c.isBuy && c.simulated)).toBe(true);
    expect((await fetchPosition(keys.owner.address, orderId32(bet.json.id)))?.status).toBe(
      'settled',
    );
    expect(
      (await publicClient().getTransactionReceipt({ hash: s.tempoPayoutTx as Hex })).status,
    ).toBe('success');
    ev('kalshi: settle_position', explorer(s.solanaTx ?? ''));
    ev('kalshi: tempo memo payout', explorerTx(s.tempoPayoutTx as Hex));
    const afterSingle = (await api('GET', '/api/balance')).json.availableUsd;
    expect(afterSingle).toBeCloseTo(80 + Number(s.payoutUsd), 6);

    // 4. routed bet on a multi-venue event: one saga per leg, shared routeKey
    const events = (await api('GET', '/api/venues/events?multiVenue=true')).json.events as {
      eventKey: string;
      venues: { venue: string }[];
    }[];
    const event = events.find((e) => e.venues.every((v) => v.venue !== 'hyperliquid'));
    expect(event).toBeTruthy();
    const routeKey = randomUUID();
    const routed = await api('POST', '/api/bets/routed', {
      eventKey: event?.eventKey,
      side: 'yes',
      stakeUsd: 40,
      idempotencyKey: routeKey,
    });
    console.log(JSON.stringify(routed.json.route, null, 1));
    expect(routed.status).toBe(201);
    const legs = routed.json.orders as {
      id: string;
      routeKey: string;
      step: string;
      stakeUsd: string;
      filledSize: string;
      solanaOpenTx: string;
    }[];
    expect(legs.length).toBe(routed.json.route.legs.length);
    expect(legs.every((o) => o.routeKey === routeKey && o.step === 'executed')).toBe(true);
    const staked = legs.reduce((t, o) => t + Number(o.stakeUsd), 0);
    expect(staked).toBeLessThanOrEqual(40 + 1e-6);
    expect((await api('GET', '/api/balance')).json.availableUsd).toBeCloseTo(
      afterSingle - staked,
      6,
    );
    for (const o of legs) ev(`route leg ${o.id}: open_position`, explorer(o.solanaOpenTx));

    // replay: same legs, no new chain writes
    const replay = await api('POST', '/api/bets/routed', {
      eventKey: event?.eventKey,
      side: 'yes',
      stakeUsd: 40,
      idempotencyKey: routeKey,
    });
    expect((replay.json.orders as { id: string }[]).map((o) => o.id).sort()).toEqual(
      legs.map((o) => o.id).sort(),
    );

    for (const o of legs) {
      const ls = await settleOrder(db, exec, o.id, { kind: 'close' });
      expect(ls?.outcome).toBe('closed');
      expect((await fetchPosition(keys.owner.address, orderId32(o.id)))?.status).toBe('settled');
    }
  }, 900_000);
});
