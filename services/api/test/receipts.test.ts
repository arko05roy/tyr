// PRD Phase 10 gate — receipts & proofs on live testnets: a real Flow A settlement (passkey signup →
// $60 limit → $40 bankroll → $25 bet → real close-at-mark) gets a `bet` receipt; its hash, Tempo
// memo payout, Solana Position PDA + payout-commitment opening, CT escrow → user transfer and the
// auditor attestation are all re-checked against the chains. Private → owner only; public → anyone.
// Tampering with the payload or the opening fails verification. Existing bet+hedge / zcash-payout
// receipts in the DB are verified too (zcash only when the regtest sidecar is up).
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@tyr/db';
import { createExecutor, featuredMarkets } from '@tyr/hyperliquid';
import { confidentialAccount, settleOrder } from '@tyr/pipeline';
import { issueReceipts, verifyReceipt } from '@tyr/receipts';
import { applyPending, ataOf, deposit, explorer, mintPublic } from '@tyr/solana';
import { chain, explorerTx, memo32, relyingParty, rpcUrl, usd } from '@tyr/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, http, publicActions, type Address } from 'viem';
import { Account, Actions, withRelay } from 'viem/tempo';
import { SoftAuthenticator } from '../../../packages/tempo/test/softAuthenticator.js';
import { fund } from '../../../packages/tempo/test/helpers.js';
import { buildApp } from '../src/app.js';

const db = new PrismaClient();
const exec = createExecutor();
let base = '';
let close: () => Promise<void>;

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

/** A cookie jar per client, so owner and stranger are separate sessions. */
function client() {
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

async function signup(api: ReturnType<typeof client>) {
  const rp = relyingParty();
  const auth = new SoftAuthenticator(rp.rpId, rp.origin);
  const opts = await api('POST', '/api/auth/passkey/register/options');
  const reg = await api(
    'POST',
    '/api/auth/passkey/register/verify',
    auth.create(opts.json.challenge),
  );
  expect(reg.status).toBe(200);
  return { reg, auth, rp };
}

const ev = (label: string, url: string) => console.log(`[evidence] ${label}: ${url}`);
const failed = (v: { checks: { name: string; ok: boolean }[] }) =>
  v.checks.filter((c) => !c.ok).map((c) => c.name);

describe('receipts & proofs (live Tempo + Solana devnet + HL testnet)', () => {
  it('Flow A settlement → bet receipt → prove → verify against chain', async () => {
    const api = client();
    const { reg, auth, rp } = await signup(api);
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

    await fund(reg.json.tempoAddress as Address, usd(40));
    const user = await db.user.findUniqueOrThrow({
      where: { tempoAddress: reg.json.tempoAddress },
    });
    const keys = await confidentialAccount(db, user.id);
    await mintPublic(await ataOf(keys.owner.address), usd(40));
    await deposit(keys, usd(40));
    await applyPending(keys);

    const markets = await featuredMarkets();
    const m = markets.reduce((a, b) => (b.yes.bid / b.yes.ask > a.yes.bid / a.yes.ask ? b : a));
    const bet = await api('POST', '/api/bets', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 25,
      idempotencyKey: randomUUID(),
    });
    expect(bet.status).toBe(201);
    const orderId = bet.json.id as string;

    // Nothing to receipt before settlement.
    await issueReceipts(db);
    expect((await api('GET', '/api/receipts')).json.receipts).toEqual([]);

    const s = await settleOrder(db, exec, orderId, { kind: 'close' });
    if (!s) throw new Error('close-at-mark did not fully unwind against the live book');
    await issueReceipts(db);
    await issueReceipts(db); // idempotent: still exactly one receipt for this bet

    // 10.1 — one private bet receipt, hash of canonical JSON
    const list = (await api('GET', '/api/receipts')).json.receipts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'bet', subjectId: orderId, visibility: 'private' });
    const id = list[0].id as string;
    const got = await api('GET', `/api/receipts/${id}`);
    expect(got.json.payload).toMatchObject({
      kind: 'bet',
      orderId,
      outcome: 'closed',
      stakeUsd: 25,
      payoutUsd: Number(s.payoutUsd),
      tempo: { payoutTx: s.tempoPayoutTx, memo: memo32(orderId), to: reg.json.tempoAddress },
      solana: { settleTx: s.solanaTx, escrowPayTx: s.escrowPayTx, owner: keys.owner.address },
    });

    // private → a stranger (fresh session) and an anonymous caller both get 404
    const stranger = client();
    await signup(stranger);
    expect((await stranger('GET', `/api/receipts/${id}`)).status).toBe(404);
    expect((await client()('GET', `/api/receipts/${id}/verify`)).status).toBe(404);
    expect(
      (await stranger('PUT', `/api/receipts/${id}/visibility`, { visibility: 'public' })).status,
    ).toBe(404);

    // 10.2 — prove: Tempo tx + memo, Solana opening, auditor attestation of the CT payout
    const proof = (await api('GET', `/api/receipts/${id}/proof`)).json;
    expect(proof.tempo[0]).toMatchObject({ tx: s.tempoPayoutTx, memo: memo32(orderId) });
    expect(proof.solana.settleTx).toBe(s.solanaTx);
    expect(proof.solana.opening.salt).toBe(s.payoutSalt);
    if (s.escrowPayTx) {
      const att = proof.solana.attestations[0];
      expect(att.tx).toBe(s.escrowPayTx);
      expect(BigInt(att.attestation.statement.amount)).toBe(usd(Number(s.payoutUsd)));
    }

    // 10.3 — verify against the chains
    const v = (await api('GET', `/api/receipts/${id}/verify`)).json;
    expect(failed(v)).toEqual([]);
    expect(v.ok).toBe(true);
    const names = v.checks.map((c: { name: string }) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'payload hash',
        'tempo payout memo',
        'solana.settleTx confirmed',
        'solana.position settled',
      ]),
    );
    if (s.escrowPayTx)
      expect(names).toEqual(
        expect.arrayContaining([
          'solana escrow → user transfer',
          'solana escrow → user auditor attestation',
        ]),
      );

    // publish → anyone can verify; unpublish → private again
    const pub = await api('PUT', `/api/receipts/${id}/visibility`, { visibility: 'public' });
    expect(pub.json.visibility).toBe('public');
    const anon = client();
    expect((await anon('GET', `/api/receipts/${id}/verify`)).json.ok).toBe(true);
    expect((await anon('GET', `/api/receipts/${id}/proof`)).json.payloadHash).toBe(
      list[0].payloadHash,
    );
    await api('PUT', `/api/receipts/${id}/visibility`, { visibility: 'private' });
    expect((await anon('GET', `/api/receipts/${id}`)).status).toBe(404);

    // tampering is caught: inflated payout (hash + opening), a wrong salt (opening)
    const row = await db.receipt.findUniqueOrThrow({ where: { id } });
    const payload = row.payload as Record<string, unknown>;
    const inflated = await verifyReceipt(db, {
      ...row,
      payload: { ...payload, payoutUsd: Number(s.payoutUsd) + 1 },
    });
    expect(inflated.ok).toBe(false);
    expect(failed(inflated)).toContain('payload hash');
    expect(failed(inflated)).toContain('solana.position settled');
    const badSalt = await verifyReceipt(db, {
      ...row,
      proof: {
        ...(row.proof as Record<string, unknown>),
        solana: { ...proof.solana, opening: { ...proof.solana.opening, salt: '00'.repeat(32) } },
      },
    });
    expect(failed(badSalt)).toEqual(['solana.position settled']);

    ev('receipt tempo payout', explorerTx(s.tempoPayoutTx as `0x${string}`));
    if (s.solanaTx) ev('receipt solana settle', explorer(s.solanaTx));
    if (s.escrowPayTx) ev('receipt solana CT payout (attested)', explorer(s.escrowPayTx));
    console.log(`[evidence] receipt ${id} payloadHash ${list[0].payloadHash}`);
  }, 600_000);

  it('existing bet+hedge receipts (Phase 9) backfill and verify', async () => {
    await issueReceipts(db);
    const r = await db.receipt.findFirst({
      where: { kind: 'bet+hedge' },
      orderBy: { createdAt: 'desc' },
    });
    if (!r) return console.warn('no bet+hedge receipt in DB — run e2e.flowD first');
    expect(r.payload).not.toBeNull();
    const v = await verifyReceipt(db, r);
    expect(failed(v)).toEqual([]);
    expect(v.checks.map((c) => c.name)).toContain('tempo receipt anchor');
  }, 300_000);

  it('existing zcash-payout receipts verify (regtest sidecar)', async () => {
    const up = await fetch(`${process.env.ZCASH_SIDECAR_URL ?? 'http://127.0.0.1:7200'}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (!up) return console.warn('zcash sidecar not running — skipping');
    await issueReceipts(db);
    const r = await db.receipt.findFirst({
      where: { kind: 'zcash-payout' },
      orderBy: { createdAt: 'desc' },
    });
    if (!r) return console.warn('no zcash payout in DB — run zcash.e2e first');
    const v = await verifyReceipt(db, r);
    expect(failed(v)).toEqual([]);
  }, 300_000);
});
