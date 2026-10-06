// PRD 11 — API contract, live. (1) openapi.yaml is exactly what the code generates (no drift);
// (2) every spec operation is exercised against the running server through the generated
// @tyr/api-client, with the server in 'strict' mode — any response that violates its schema is a
// 500, so "no 5xx" = every response matched the contract. Money-moving 2xx paths (bets, hedge,
// deposit claim, agent MPP) are covered under the same strict mode by the Flow A–D e2e suites.
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@tyr/db';
import { createTyrClient } from '@tyr/api-client';
import { relyingParty, signAgentRequest } from '@tyr/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parse } from 'yaml';
import { SoftAuthenticator } from '../../../packages/tempo/test/softAuthenticator.js';
import { buildApp } from '../src/app.js';
import { SPEC_PATH, generateSpec } from '../src/openapi.js';
import { Deposit, Hedge, Order } from '../src/schemas.js';

const db = new PrismaClient();
let base = '';
let close: () => Promise<void>;
let cookie = '';
const hits = new Map<string, Set<number>>(); // "GET /api/x/{id}" → statuses seen

const record = (method: string, path: string, status: number) => {
  const k = `${method.toUpperCase()} ${path}`;
  hits.set(k, (hits.get(k) ?? new Set()).add(status));
  expect(status, `${k} returned ${status}`).toBeLessThan(500);
};

const client = () =>
  createTyrClient({
    baseUrl: base,
    fetch: async (req: Request) => {
      if (cookie) req.headers.set('cookie', cookie);
      const res = await fetch(req);
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0] ?? '';
      return res;
    },
  });
let api: ReturnType<typeof client>;

beforeAll(async () => {
  const app = await buildApp({
    db,
    cookieSecret: process.env.TYR_SECRETS_KEY ?? '',
    responseCheck: 'strict',
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = () => app.close();
  api = client();
  api.use({
    onResponse({ schemaPath, request, response }) {
      record(request.method, schemaPath, response.status);
    },
  });
});
afterAll(async () => {
  await close();
  await db.$disconnect();
});

type Op = { method: string; path: string; security: string[] };
const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as {
  paths: Record<string, Record<string, { security?: Record<string, string[]>[] }>>;
};
const ops: Op[] = Object.entries(spec.paths).flatMap(([path, byMethod]) =>
  Object.entries(byMethod).map(([method, op]) => ({
    method: method.toUpperCase(),
    path,
    security: (op.security ?? []).flatMap((s) => Object.keys(s)),
  })),
);
/** Asserts presence (the test fails here, not on a later property read). */
function must<T>(x: T | null | undefined, what: string): T {
  if (x === null || x === undefined) throw new Error(`missing ${what}`);
  return x;
}
const concrete = (path: string) => path.replace(/\{[^}]+\}/g, '1');

describe('API contract (PRD 11)', () => {
  it('openapi.yaml matches the code (regenerate: pnpm --filter @tyr/api openapi)', async () => {
    expect(await generateSpec()).toBe(readFileSync(SPEC_PATH, 'utf8'));
    expect(ops.length).toBeGreaterThanOrEqual(42);
  });

  it('every protected operation rejects anonymous callers with a contract error', async () => {
    for (const op of ops) {
      const only = new Set(op.security);
      if (only.size === 0 || only.has('')) continue;
      // receipts' public-or-owner reads list an anonymous alternative ({}), so they are skipped.
      if (
        spec.paths[op.path]?.[op.method.toLowerCase()]?.security?.some(
          (s) => !Object.keys(s).length,
        )
      )
        continue;
      const hasBody = ['POST', 'PUT'].includes(op.method);
      const res = await fetch(base + concrete(op.path), {
        method: op.method,
        headers: hasBody ? { 'content-type': 'application/json' } : {},
        ...(hasBody ? { body: '{}' } : {}),
      });
      record(op.method, op.path, res.status);
      expect(res.status, `${op.method} ${op.path}`).toBe(401);
      expect(((await res.json()) as { error: unknown }).error).toEqual(expect.any(String));
    }
  });

  it('public + session routes answer within the contract', async () => {
    expect((await api.GET('/health')).data).toEqual({ ok: true });

    // passkey signup, then login with the same authenticator
    const rp = relyingParty();
    const auth = new SoftAuthenticator(rp.rpId, rp.origin);
    const regOpts = await api.POST('/api/auth/passkey/register/options');
    const reg = await api.POST('/api/auth/passkey/register/verify', {
      body: auth.create(must(regOpts.data, 'register options').challenge) as never,
    });
    expect(reg.response.status).toBe(200);
    const loginOpts = await api.POST('/api/auth/passkey/login/options');
    const login = await api.POST('/api/auth/passkey/login/verify', {
      body: auth.get(must(loginOpts.data, 'login options').challenge) as never,
    });
    expect(login.data?.userId).toBe(reg.data?.userId);
    const bad = await api.POST('/api/auth/passkey/login/verify', {
      body: auth.get('not-a-real-challenge') as never,
    });
    expect(bad.response.status).toBe(401);
    expect((await api.GET('/api/auth/me')).data?.region).toBeNull();

    // validation errors are 400 { error, code: 'validation', issues }
    const v = await api.PUT('/api/auth/region', { body: { region: 'not a region' } });
    expect(v.response.status).toBe(400);
    const v2 = await api.POST('/api/limits/prepare', { body: { amountUsd: -1, period: 'day' } });
    expect(v2.error).toMatchObject({
      code: 'validation',
      issues: [expect.objectContaining({ path: expect.any(String) })],
    });
    expect(
      (await api.GET('/api/hedge/markets/{marketId}', { params: { path: { marketId: 1 } } }))
        .response.status,
    ).toBe(403);
    const region = await api.PUT('/api/auth/region', { body: { region: 'de' } });
    expect(region.data).toEqual({ region: 'DE', hedge: { eligible: true } });

    // limits
    expect((await api.GET('/api/limits')).data).toEqual({ limit: null });
    const prep = await api.POST('/api/limits/prepare', { body: { amountUsd: 20, period: 'day' } });
    expect(prep.data?.accessKey.keyType).toBe('p256');
    expect(
      (
        await api.PUT('/api/limits/confirm', {
          body: { limitId: 'nope', txHash: `0x${'0'.repeat(64)}` },
        })
      ).response.status,
    ).toBe(404);

    // markets (live HL testnet)
    const markets = await api.GET('/api/markets');
    const m = must(markets.data?.markets[0], 'featured market');
    expect(m).toBeDefined();
    const detail = await api.GET('/api/markets/{id}', { params: { path: { id: m.outcome } } });
    expect(detail.data?.books.yes.levels).toHaveLength(2);
    expect(
      (await api.GET('/api/markets/{id}', { params: { path: { id: 999_999_999 } } })).response
        .status,
    ).toBe(404);

    // venues (HL live + simulated Polymarket / Kalshi / Limitless)
    const venues = await api.GET('/api/venues');
    expect(venues.data?.venues.map((v) => v.id)).toContain('hyperliquid');
    const all = await api.GET('/api/venues/markets');
    const vm = must(
      all.data?.markets.find((x) => x.venue === 'kalshi'),
      'kalshi market',
    );
    const vd = await api.GET('/api/venues/markets/{id}', { params: { path: { id: vm.id } } });
    expect(vd.data?.books.no.asks.length).toBeGreaterThan(0);
    expect(
      (await api.GET('/api/venues/markets/{id}', { params: { path: { id: 'nowhere:1' } } }))
        .response.status,
    ).toBe(400);
    const evs = await api.GET('/api/venues/events', { params: { query: { multiVenue: true } } });
    const ev = must(evs.data?.events[0], 'multi-venue event');
    const route = await api.POST('/api/venues/route', {
      body: { eventKey: ev.eventKey, side: 'yes', stakeUsd: 500 },
    });
    expect(route.data?.contracts).toBeGreaterThan(0);

    // hedge (eligible region now)
    const offer = await api.GET('/api/hedge/markets/{marketId}', {
      params: { path: { marketId: m.outcome } },
    });
    expect(offer.data).toHaveProperty('offered');
    expect(
      (await api.GET('/api/hedge/{orderId}/quote', { params: { path: { orderId: 'nope' } } }))
        .response.status,
    ).toBe(404);
    expect((await api.POST('/api/hedge', { body: { orderId: 'nope' } })).response.status).toBe(404);
    expect((await api.GET('/api/hedge')).data).toEqual({ hedges: [] });
    expect(
      (await api.GET('/api/hedge/{orderId}', { params: { path: { orderId: 'nope' } } })).response
        .status,
    ).toBe(404);

    // bets + balance (balance creates the confidential account on devnet)
    expect((await api.GET('/api/bets')).data).toEqual({ bets: [] });
    expect(
      (await api.GET('/api/bets/{id}', { params: { path: { id: 'nope' } } })).response.status,
    ).toBe(404);
    const bet = await api.POST('/api/bets', {
      body: {
        outcome: m.outcome,
        side: 'yes',
        stakeUsd: 1,
        idempotencyKey: `contract-${Date.now()}`,
      },
    });
    expect(bet.error?.error).toMatch(/minimum order is \$10/); // rejected before any chain write
    expect((await api.GET('/api/balance')).data).toEqual({ availableUsd: 0, token: 'tyrUSD' });

    // deposits
    const addrs = await api.GET('/api/deposits/addresses');
    expect(addrs.data?.evm.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect((await api.GET('/api/deposits')).data).toEqual({ deposits: [] });
    const claim = await api.POST('/api/deposits/claim', {
      body: { chain: 'sepolia', txHash: `0x${'ab'.repeat(32)}` },
    });
    expect(claim.error?.code).toBe('not_found');

    // receipts (none yet for a fresh user)
    expect((await api.GET('/api/receipts')).data).toEqual({ receipts: [] });
    const r404 = { params: { path: { id: 'nope' } } };
    expect((await api.GET('/api/receipts/{id}', r404)).response.status).toBe(404);
    expect((await api.GET('/api/receipts/{id}/proof', r404)).response.status).toBe(404);
    expect((await api.GET('/api/receipts/{id}/verify', r404)).response.status).toBe(404);
    expect(
      (await api.PUT('/api/receipts/{id}/visibility', { ...r404, body: { visibility: 'public' } }))
        .response.status,
    ).toBe(404);

    // agent sessions (owner side) — create + revoke; on-chain confirm is covered by agent.mpp
    const agentKey = privateKeyToAccount(generatePrivateKey());
    const created = await api.POST('/api/agent/sessions', {
      body: { agentAddress: agentKey.address, capUsd: 1, name: 'contract' },
    });
    expect(created.response.status).toBe(201);
    const sid = must(created.data, 'agent session').sessionId;
    expect(
      (
        await api.PUT('/api/agent/sessions/{id}/confirm', {
          params: { path: { id: sid } },
          body: { txHash: 'bad' },
        })
      ).response.status,
    ).toBe(400);
    expect((await api.GET('/api/agent/sessions')).data?.sessions[0]).toMatchObject({
      id: sid,
      active: false,
      remainingUsd: null,
    });
    expect(
      (await api.DELETE('/api/agent/sessions/{id}', { params: { path: { id: sid } } })).data,
    ).toEqual({ sessionId: sid, revoked: true });

    // sponsor relay speaks JSON-RPC
    const rpc = await api.POST('/api/tempo/sponsor', {
      body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    });
    expect(rpc.response.status).toBeLessThan(500);
  });

  it('agent routes: signed but unconfirmed key → 403 on every agent operation', async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    for (const op of ops.filter((o) => o.security.includes('agent'))) {
      const path = concrete(op.path);
      const body = op.method === 'POST' ? JSON.stringify({}) : undefined;
      const headers = await signAgentRequest(key, {
        method: op.method,
        path,
        ...(body ? { body } : {}),
      });
      const res = await fetch(base + path, {
        method: op.method,
        headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body } : {}),
      });
      record(op.method, op.path, res.status);
      expect(res.status, `${op.method} ${op.path}`).toBe(403);
    }
  });

  it('public receipt + Flow B capability routes serve real receipts within the contract', async () => {
    const r = must(
      await db.receipt.findFirst({ where: { kind: 'bet' }, orderBy: { createdAt: 'desc' } }),
      'bet receipt in DB (run receipts.test first)',
    );
    const anon = client();
    anon.use({
      onResponse: ({ schemaPath, request, response }) =>
        record(request.method, schemaPath, response.status),
    });
    const prior = r.visibility;
    await db.receipt.update({ where: { id: r.id }, data: { visibility: 'public' } });
    cookie = '';
    try {
      const p = { params: { path: { id: r.id } } };
      expect((await anon.GET('/api/receipts/{id}', p)).data?.payloadHash).toBe(r.payloadHash);
      expect((await anon.GET('/api/receipts/{id}/proof', p)).data?.receiptId).toBe(r.id);
      expect((await anon.GET('/api/receipts/{id}/verify', p)).data?.ok).toBe(true);
    } finally {
      await db.receipt.update({ where: { id: r.id }, data: { visibility: prior } });
    }

    const txid = must(
      (await db.receipt.findFirst({ where: { kind: 'zcash-payout' } }))?.subjectId,
      'zcash-payout receipt in DB',
    );
    const t = { params: { path: { txid } } };
    expect((await anon.GET('/api/zcash/orders/{txid}', t)).data?.txid).toBe(txid);
    expect((await anon.GET('/api/zcash/orders/{txid}/receipt', t)).data?.verification.ok).toBe(
      true,
    );
    expect((await anon.GET('/api/zcash/orders/{txid}/disclosure', t)).data?.matches).toBe(true);
    const req = await anon.POST('/api/zcash/request', {
      body: { outcome: 0, side: 'yes', stakeUsd: 1, returnUA: 'not-a-ua' },
    });
    expect(req.response.status).toBe(400);
    const markets = await anon.GET('/api/markets');
    const ok = await anon.POST('/api/zcash/request', {
      body: {
        outcome: must(markets.data?.markets[0], 'featured market').outcome,
        side: 'yes',
        stakeUsd: 10,
        returnUA: 'uregtest1contracttest',
      },
    });
    expect(ok.data?.uri).toMatch(/^zcash:/);

    const admin = await fetch(`${base}/api/admin/revenue`, {
      headers: { authorization: `Bearer ${process.env.TYR_ADMIN_TOKEN}` },
    });
    record('GET', '/api/admin/revenue', admin.status);
    expect(admin.status).toBe(200);
  });

  it('every persisted Order / Deposit / Hedge row matches its wire schema', async () => {
    const wire = (x: unknown): unknown =>
      JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    const check = (
      name: string,
      schema: { safeParse: (x: unknown) => { success: boolean; error?: unknown } },
      rows: unknown[],
    ) => {
      expect(rows.length, `no ${name} rows to check`).toBeGreaterThan(0);
      for (const row of rows) {
        const r = schema.safeParse(wire(row));
        expect(r.success, `${name} ${JSON.stringify(r.error)}`).toBe(true);
      }
    };
    check('Order', Order, await db.order.findMany({ include: { settlement: true } }));
    check('Deposit', Deposit, await db.deposit.findMany());
    check('Hedge', Hedge, await db.hedge.findMany());
  });

  it('every operation in the spec was exercised', () => {
    const missing = ops.map((o) => `${o.method} ${o.path}`).filter((k) => !hits.has(k));
    expect(missing).toEqual([]);
    const no2xx = [...hits].filter(([, s]) => ![...s].some((c) => c < 300)).map(([k]) => k);
    console.log(
      `contract: ${hits.size} operations exercised; error-path only: ${no2xx.join(', ')}`,
    );
  });
});
