// PRD Phase 7 gate — Flow B end-to-end on the local Zcash regtest (owner-approved deviation) +
// live HL testnet book + Solana devnet:
//   POST /api/zcash/request → user wallet pays the ZIP-321 URI (shielded, memo-as-order)
//   → tyr's sidecar decrypts the memo → ZcashOrder → float bet: open_position (devnet) + HL fill
//   → close at mark (real close order) → settle_position → FROST 2-of-3 authorized shielded payout
//   to the memo's return UA with memo = receipt id → user wallet sees it.
// Underpaid note → full ZEC refund through the same FROST path.
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@tyr/db';
import { createExecutor, featuredMarkets } from '@tyr/hyperliquid';
import { confidentialAccount, settleOrder } from '@tyr/pipeline';
import { explorer, fetchPosition, orderId32 } from '@tyr/solana';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../services/api/src/app.js';
import {
  encodeMemo,
  payoutZcash,
  paymentUri,
  scanZcash,
  zcashDisclosure,
  zcashRelayerUser,
} from '../src/index.js';
import { ev, mine, must, tyr, until, user } from './helpers.js';

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
  await mine(5); // make the user's notes spendable
});
afterAll(async () => {
  await close();
  await db.$disconnect();
});

const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, string> };
};

/** Scan until the note `txid` has a ZcashOrder past `received`. */
const scanned = (txid: string) =>
  until(async () => {
    await tyr.sync();
    await scanZcash(db, exec);
    const zo = await db.zcashOrder.findUnique({ where: { txid } });
    return zo && zo.status !== 'received' ? zo : null;
  }, `ZcashOrder for ${txid}`);

/** Payout tick until the order is paid/refunded; then mine and wait for the user wallet to see it. */
async function paidOut(id: string, final: 'paid' | 'refunded') {
  const zo = await until(async () => {
    await payoutZcash(db);
    const z = await db.zcashOrder.findUniqueOrThrow({ where: { id } });
    return z.status === final ? z : null;
  }, `${final} ${id}`);
  await mine(1);
  const seen = await until(
    async () => (await user.incoming()).find((t) => t.txid === zo.payoutTxid && t.confirmed),
    `user wallet to see payout ${zo.payoutTxid}`,
  );
  return { zo, seen };
}

describe('Flow B — shielded memo order', () => {
  it('memo bet → HL fill → close at mark → FROST-authorized shielded payout', async () => {
    const m = (await featuredMarkets())[0];
    if (!m) throw new Error('no featured HL testnet market');
    const returnUA = await user.address();

    const bad = await post('/api/zcash/request', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 25,
      returnUA: 'tm1',
    });
    expect(bad.status).toBe(400);

    const req = await post('/api/zcash/request', {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: 25,
      returnUA,
    });
    expect(req.status).toBe(200);
    expect(req.json.uri).toMatch(/^zcash:uregtest1[0-9a-z]+\?amount=0\.\d+&memo=[A-Za-z0-9_-]+$/);
    ev('ZIP-321 request', must(req.json.uri, 'uri'));

    // user's wallet pays exactly the URI tyr returned
    const { txids } = await user.send(must(req.json.uri, 'uri'));
    const txid = must(txids.at(-1), 'txid');
    ev('shielded order tx (regtest)', txid);
    await mine(1);

    const zo = await scanned(txid);
    expect(zo).toMatchObject({
      status: 'placed',
      marketId: String(m.outcome),
      side: 'yes',
      returnAddr: returnUA,
    });
    expect(Number(zo.zecUsd)).toBeGreaterThan(0);
    expect(zo.rateSource).toBe('coingecko:simple/price');
    const order = await db.order.findUniqueOrThrow({ where: { id: must(zo.orderId, 'orderId') } });
    expect(Number(order.filledSize)).toBeGreaterThan(0);
    expect(order.tempoStakeTx).toBeNull(); // float funded: no Tempo leg
    expect(order.escrowTx).toBeNull(); // and no user CT debit
    const owner = await zcashRelayerUser(db);
    const keys = await confidentialAccount(db, owner.id);
    expect((await fetchPosition(keys.owner.address, orderId32(order.id)))?.status).toBe('open');
    ev('open_position (flow B)', explorer(must(order.solanaOpenTx, 'open tx')));

    const status = await fetch(`${base}/api/zcash/orders/${txid}`).then((r) => r.json());
    expect(status).toMatchObject({ status: 'placed', orderId: order.id });

    const s = await settleOrder(db, exec, order.id, { kind: 'close' });
    if (!s) throw new Error('close-at-mark did not fully unwind against the live book');
    expect((await fetchPosition(keys.owner.address, orderId32(order.id)))?.status).toBe('settled');
    ev('settle_position (flow B)', explorer(must(s.solanaTx, 'settle tx')));

    const { zo: paid, seen } = await paidOut(zo.id, 'paid');
    expect(paid.frostSig).toMatch(/^[0-9a-f]{128}$/);
    expect(paid.frostSigners).toMatch(/^\d,\d$/);
    expect(BigInt(seen.value)).toBe(paid.payoutZat);
    expect(seen.memos.join('')).toContain(`tyr receipt ${zo.id}`);

    // PRD 7.7 viewing-key receipt for this one payout
    const d = (await fetch(`${base}/api/zcash/orders/${txid}/disclosure`).then((r) =>
      r.json(),
    )) as Awaited<ReturnType<typeof zcashDisclosure>> & {};
    expect(d).toMatchObject({
      kind: 'zcash-ovk-view+frost',
      payoutTxid: paid.payoutTxid,
      matches: true,
      frost: { valid: true, threshold: '2-of-3' },
      view: { recipient: returnUA, value: Number(paid.payoutZat) },
    });
    const forged = await tyr.frostVerify(
      { ...d.instruction, zat: d.instruction.zat + 1 },
      d.frost.signature,
    );
    expect(forged.valid).toBe(false);
    ev(
      'FROST-authorized ZEC payout (regtest)',
      `${paid.payoutTxid} (${paid.payoutZat} zat, signers ${paid.frostSigners})`,
    );
  });

  it('underpaid note → full shielded refund', async () => {
    const m = must((await featuredMarkets())[0], 'featured market');
    const memo = encodeMemo({
      outcome: m.outcome,
      side: 0,
      sizeCents: 2500,
      returnUA: await user.address(),
      nonce: randomBytes(8).toString('hex'),
    });
    await mine(5); // change from the previous send must be spendable
    const { txids } = await user.send(paymentUri(await tyr.address(), 10_000n, memo));
    const txid = must(txids.at(-1), 'txid');
    await mine(1);

    const zo = await scanned(txid);
    expect(zo.status).toBe('refunding');
    expect(zo.error).toMatch(/stake needs/);
    const { zo: done, seen } = await paidOut(zo.id, 'refunded');
    expect(done.payoutZat).toBe(10_000n);
    expect(BigInt(seen.value)).toBe(10_000n);
    ev('ZEC refund (regtest)', must(done.payoutTxid, 'refund txid'));
  });
});
