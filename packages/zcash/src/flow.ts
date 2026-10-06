// PRD 7.3/7.4/7.6 — Flow B: shielded memo-as-order.
//
//   request  → ZIP-321 URI (tyr UA, ZEC amount = stake at the CoinGecko rate + 2% buffer, memo)
//   scan     → tyr's sidecar decrypts incoming notes with its viewing key; a confirmed note with a
//              tyr1: memo becomes a ZcashOrder (txid unique → each note is processed once)
//   place    → the Flow A pipeline with funding 'float' (tyr's float pays HL; real Solana
//              position + HL order), owned by the system "zcash relayer" user
//   payout   → once the order has a Settlement: payoutUsd at the ENTRY rate + any excess ZEC
//              received, sent shielded to the memo's return UA with memo = receipt id, through
//              the FROST 2-of-3 authorized sidecar
//
// Status: received → placed → settled → paid | closed (nothing owed)
//         refunding → refunded (underpaid / market rejected) | rejected (no decodable return UA)
//         needs_operator (signers report the receipt was already signed — never auto-retried)
import { Prisma, type PrismaClient } from '@tyr/db';
import { featuredMarkets, type Executor } from '@tyr/hyperliquid';
import { BetRejectedError, placeBet } from '@tyr/pipeline';
import { randomBytes } from 'node:crypto';
import { MEMO_PREFIX, MemoError, decodeMemo, encodeMemo } from './memo.js';
import { usdToZatCeil, usdToZatFloor, zecUsd } from './rate.js';
import { SidecarError, sidecar, type PayoutInstruction } from './sidecar.js';
import { paymentUri } from './zip321.js';

/** Quote buffer so a small ZEC/USD move between quote and receipt doesn't force a refund. */
export const RATE_BUFFER = 0.02;
const SYSTEM_CREDENTIAL = 'system:zcash-relayer';

/** Owner of every Flow B order: an internal user with no passkey and no Tempo leg. */
export async function zcashRelayerUser(db: PrismaClient) {
  return db.user.upsert({
    where: { passkeyCredentialId: SYSTEM_CREDENTIAL },
    update: {},
    create: {
      passkeyCredentialId: SYSTEM_CREDENTIAL,
      tempoAddress: SYSTEM_CREDENTIAL,
      passkeyPublicKey: '',
    },
  });
}

export class ZcashRequestError extends Error {}

export type ZcashRequestInput = {
  outcome: number;
  side: 'yes' | 'no';
  stakeUsd: number;
  returnUA: string;
};

/** PRD 7.3 — build the ZIP-321 request a wallet pays to place a shielded bet. */
export async function zcashRequest(input: ZcashRequestInput, sc = sidecar()) {
  if (!(await featuredMarkets()).some((m) => m.outcome === input.outcome))
    throw new ZcashRequestError(`outcome ${input.outcome} is not a featured live market`);
  const memo = encodeMemo({
    outcome: input.outcome,
    side: input.side === 'yes' ? 0 : 1,
    sizeCents: Math.round(input.stakeUsd * 100),
    returnUA: input.returnUA,
    nonce: randomBytes(8).toString('hex'),
  });
  const rate = await zecUsd();
  const zat = usdToZatCeil(input.stakeUsd * (1 + RATE_BUFFER), rate.usd);
  const to = await sc.address();
  return { uri: paymentUri(to, zat, memo), to, zat: zat.toString(), memo, zecUsd: rate.usd };
}

/** Scan + place: record new confirmed tyr-memo notes, then run each through the pipeline. */
export async function scanZcash(db: PrismaClient, exec: Executor, sc = sidecar()) {
  const seen: string[] = [];
  for (const t of await sc.incoming()) {
    const text = t.memos.find((m) => m.startsWith(MEMO_PREFIX));
    if (!t.confirmed || !text) continue;
    if (await db.zcashOrder.findUnique({ where: { txid: t.txid } })) continue;
    const base = {
      txid: t.txid,
      memoRaw: Buffer.from(text),
      valueZat: BigInt(t.value),
      height: t.height,
    };
    try {
      const m = decodeMemo(text);
      await db.zcashOrder.create({
        data: {
          ...base,
          marketId: String(m.outcome),
          side: m.side === 0 ? 'yes' : 'no',
          size: m.sizeCents / 100,
          returnAddr: m.returnUA,
          nonce: m.nonce,
          status: 'received',
        },
      });
    } catch (e) {
      if (!(e instanceof MemoError)) throw e;
      // No trustworthy return address → nothing can be refunded automatically.
      await db.zcashOrder.create({
        data: {
          ...base,
          marketId: '',
          side: 'yes',
          size: 0,
          returnAddr: '',
          status: 'rejected',
          error: e.message,
        },
      });
    }
    seen.push(t.txid);
  }

  const placed: string[] = [];
  const owner = await zcashRelayerUser(db);
  for (const zo of await db.zcashOrder.findMany({ where: { status: 'received' } })) {
    const rate = await zecUsd();
    const stakeUsd = Number(zo.size);
    const need = usdToZatCeil(stakeUsd, rate.usd);
    const rated = { zecUsd: rate.usd, rateSource: rate.source };
    if (stakeUsd <= 0 || zo.valueZat < need) {
      await refund(
        db,
        zo.id,
        `received ${zo.valueZat} zat, stake needs ${need} zat at $${rate.usd}`,
        rated,
      );
      continue;
    }
    try {
      const order = await placeBet(db, exec, {
        userId: owner.id,
        outcome: Number(zo.marketId),
        side: zo.side,
        stakeUsd,
        idempotencyKey: `zcash:${zo.txid}`,
        funding: 'float',
      });
      await db.zcashOrder.update({
        where: { id: zo.id },
        data: { ...rated, excessZat: zo.valueZat - need, orderId: order.id, status: 'placed' },
      });
      placed.push(zo.id);
    } catch (e) {
      if (!(e instanceof BetRejectedError)) throw e;
      await refund(db, zo.id, e.message, rated);
    }
  }
  return { seen, placed };
}

async function refund(
  db: PrismaClient,
  id: string,
  reason: string,
  data: Prisma.ZcashOrderUpdateInput = {},
) {
  const zo = await db.zcashOrder.findUniqueOrThrow({ where: { id } });
  await db.zcashOrder.update({
    where: { id },
    data: { ...data, status: 'refunding', error: reason, payoutZat: zo.valueZat },
  });
}

const instructionFor = (zo: {
  id: string;
  returnAddr: string;
  payoutZat: bigint | null;
}): PayoutInstruction => ({
  v: 1,
  receipt_id: zo.id,
  to: zo.returnAddr,
  zat: Number(zo.payoutZat),
  memo: `tyr receipt ${zo.id}`,
});

/**
 * PRD 7.7 — viewing-key receipt for ONE payout. zingolib has no ZIP-311 payment disclosure, so
 * this is the honest equivalent: tyr's wallet decrypts its own outgoing outputs for that single
 * txid (OVK view), and the 2-of-3 FROST signature over the payout instruction is re-verified.
 * `matches` is true only if the decrypted output is exactly the signed instruction.
 */
export async function zcashDisclosure(db: PrismaClient, txid: string, sc = sidecar()) {
  const zo = await db.zcashOrder.findUnique({ where: { txid } });
  if (!zo?.payoutTxid || !zo.frostSig) return null;
  const ix = instructionFor(zo);
  const [view, check, group] = await Promise.all([
    sc.outgoing(zo.payoutTxid),
    sc.frostVerify(ix, zo.frostSig),
    sc.frostGroup(),
  ]);
  const out = view.outputs.find((o) => o.recipient === ix.to);
  return {
    kind: 'zcash-ovk-view+frost' as const,
    receiptId: zo.id,
    orderTxid: zo.txid,
    payoutTxid: zo.payoutTxid,
    view: out ?? null,
    instruction: ix,
    frost: {
      signature: zo.frostSig,
      signers: zo.frostSigners,
      verifyingKey: group.verifying_key,
      threshold: `${group.min_signers}-of-${group.max_signers}`,
      valid: check.valid,
    },
    matches:
      check.valid &&
      !!out &&
      BigInt(out.value) === BigInt(ix.zat) &&
      out.memos.join('').includes(ix.memo),
  };
}

/** Settled orders → payout amount; then send every pending payout through FROST. */
export async function payoutZcash(db: PrismaClient, sc = sidecar()) {
  const sent: string[] = [];
  const ready = await db.zcashOrder.findMany({
    where: { status: 'placed', order: { settlement: { isNot: null } } },
    include: { order: { include: { settlement: true } } },
  });
  for (const zo of ready) {
    const s = zo.order?.settlement;
    if (!s) continue;
    // Entry rate both ways: the bettor's ZEC exposure is fixed at the moment the bet is placed.
    const zat = usdToZatFloor(Number(s.payoutUsd), Number(zo.zecUsd)) + zo.excessZat;
    await db.zcashOrder.update({
      where: { id: zo.id },
      data: zat > 0n ? { status: 'settled', payoutZat: zat } : { status: 'closed', payoutZat: 0n },
    });
  }

  for (const zo of await db.zcashOrder.findMany({
    where: { status: { in: ['settled', 'refunding'] }, payoutTxid: null },
  })) {
    const ix = instructionFor(zo);
    try {
      const r = await sc.payout(ix);
      await db.zcashOrder.update({
        where: { id: zo.id },
        data: {
          payoutTxid: r.txids.at(-1) ?? null,
          frostSig: r.signature,
          frostSigners: r.signers.join(','),
          status: zo.status === 'refunding' ? 'refunded' : 'paid',
        },
      });
      sent.push(zo.id);
    } catch (e) {
      if (e instanceof SidecarError && e.status === 409) {
        await db.zcashOrder.update({
          where: { id: zo.id },
          data: { status: 'needs_operator', error: e.message },
        });
      } else throw e;
    }
  }
  return sent;
}

export function zcashWorker(db: PrismaClient, exec: Executor, sc = sidecar()) {
  return async function tick() {
    const { seen, placed } = await scanZcash(db, exec, sc);
    const paid = await payoutZcash(db, sc);
    return { seen, placed, paid };
  };
}
