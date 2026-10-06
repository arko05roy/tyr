// PRD 10.1 — a Receipt for every payout. The payload is a canonical-JSON record of what was paid
// and which chain txs carry it; payloadHash = keccak256(canonicalJson(payload)). Three kinds:
//   bet           Flow A / agent settlement: Solana settle_position + CT escrow → user + Tempo memo payout
//   zcash-payout  Flow B: shielded payout authorized by 2-of-3 FROST (plus the Solana settle leg if placed)
//   bet+hedge     Flow D combined receipt — written and Tempo-anchored by @tyr/robinhood closeHedge
// Issuance is a worker tick: idempotent (unique kind + subjectId), runs after settlement/payout.
import { canonicalJson } from '@tyr/core';
import { Prisma, type PrismaClient } from '@tyr/db';
import { commit, confidentialAccount, units } from '@tyr/pipeline';
import { combinedReceipt } from '@tyr/robinhood';
import { orderId32, positionPda } from '@tyr/solana';
import { ALPHA_USD, chain, memo32 } from '@tyr/tempo';
import { keccak256, toHex } from 'viem';

export const receiptHash = (payload: unknown) => keccak256(toHex(canonicalJson(payload)));

const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString('hex')}`;

type SettledOrder = Prisma.OrderGetPayload<{ include: { settlement: true; user: true } }>;

/** Solana leg shared by bet and zcash receipts: Position PDA + settle tx + payout commitment. */
async function solanaLeg(db: PrismaClient, o: SettledOrder) {
  const s = o.settlement;
  if (!s?.solanaTx) return null;
  const owner = (await confidentialAccount(db, o.userId)).owner.address;
  const id32 = orderId32(o.id);
  return {
    cluster: 'devnet',
    owner,
    position: await positionPda(owner, id32),
    orderId32: hex(id32),
    settleTx: s.solanaTx,
    payoutCommitment: hex(commit(units(Number(s.payoutUsd)), s.payoutSalt ?? undefined).commitment),
    escrowPayTx: s.escrowPayTx,
  };
}

/** The record a `bet` receipt commits to. Amounts are USD numbers; Tempo amount in base units. */
export async function betPayload(db: PrismaClient, o: SettledOrder) {
  const s = o.settlement;
  if (!s) throw new Error(`order ${o.id} has no settlement`);
  return {
    v: 1,
    kind: 'bet',
    orderId: o.id,
    // HL bets keep the numeric outcome id so pre-11b receipt hashes still recompute
    market: o.hlMarket !== null ? Number(o.hlMarket) : o.marketId,
    side: o.side,
    stakeUsd: Number(o.stakeUsd ?? 0),
    outcome: s.outcome,
    payoutUsd: Number(s.payoutUsd),
    pnlUsd: Number(s.pnl),
    hl: { simulated: o.simulated, filledSize: Number(o.filledSize), avgPx: Number(o.avgPx ?? 0) },
    solana: await solanaLeg(db, o),
    tempo: s.tempoPayoutTx
      ? {
          chainId: chain.id,
          token: ALPHA_USD,
          to: o.user.tempoAddress,
          amount: units(Number(o.stakeUsd ?? 0)).toString(),
          memo: memo32(o.id),
          payoutTx: s.tempoPayoutTx,
        }
      : null,
  };
}

type Zo = Prisma.ZcashOrderGetPayload<{
  include: { order: { include: { settlement: true; user: true } } };
}>;

/** The record a `zcash-payout` receipt commits to (the instruction FROST signed + its tx). */
export async function zcashPayload(db: PrismaClient, zo: Zo) {
  return {
    v: 1,
    kind: 'zcash-payout',
    orderTxid: zo.txid,
    orderId: zo.orderId,
    status: zo.status,
    stakeUsd: Number(zo.size),
    zecUsd: zo.zecUsd === null ? null : Number(zo.zecUsd),
    receivedZat: zo.valueZat.toString(),
    payout: {
      to: zo.returnAddr,
      zat: (zo.payoutZat ?? 0n).toString(),
      memo: `tyr receipt ${zo.id}`,
      txid: zo.payoutTxid,
      frostSignature: zo.frostSig,
      frostSigners: zo.frostSigners,
    },
    bet: zo.order?.settlement
      ? {
          outcome: zo.order.settlement.outcome,
          payoutUsd: Number(zo.order.settlement.payoutUsd),
          solana: await solanaLeg(db, zo.order),
        }
      : null,
  };
}

async function write(
  db: PrismaClient,
  r: { kind: string; subjectId: string; userId: string | null; payload: object },
) {
  return db.receipt.upsert({
    where: { kind_subjectId: { kind: r.kind, subjectId: r.subjectId } },
    create: {
      kind: r.kind,
      subjectId: r.subjectId,
      userId: r.userId,
      payload: r.payload as Prisma.InputJsonValue,
      payloadHash: receiptHash(r.payload),
      visibility: 'private',
    },
    update: {},
  });
}

/**
 * Issue every missing receipt. Bets: top-level orders whose saga reached `settled` (all legs
 * done), excluding Flow B orders (covered by their zcash-payout receipt). Zcash: every sent
 * payout or refund. Also backfills payload/owner on bet+hedge receipts written before Phase 10,
 * only when the recomputed hash matches the stored one.
 */
export async function issueReceipts(db: PrismaClient) {
  const issued: string[] = [];
  const bets = await db.order.findMany({
    where: {
      parentId: null,
      step: 'settled',
      settlement: { isNot: null },
      zcashOrder: null,
      NOT: { id: { in: await subjects(db, 'bet') } },
    },
    include: { settlement: true, user: true },
  });
  for (const o of bets) {
    const r = await write(db, {
      kind: 'bet',
      subjectId: o.id,
      userId: o.userId,
      payload: await betPayload(db, o),
    });
    issued.push(r.id);
  }

  const zos = await db.zcashOrder.findMany({
    where: {
      payoutTxid: { not: null },
      frostSig: { not: null },
      NOT: { txid: { in: await subjects(db, 'zcash-payout') } },
    },
    include: { order: { include: { settlement: true, user: true } } },
  });
  for (const zo of zos) {
    const r = await write(db, {
      kind: 'zcash-payout',
      subjectId: zo.txid,
      userId: zo.order?.userId ?? null,
      payload: await zcashPayload(db, zo),
    });
    issued.push(r.id);
  }

  for (const r of await db.receipt.findMany({
    where: { kind: 'bet+hedge', payload: { equals: Prisma.DbNull } },
  })) {
    const h = await db.hedge.findUnique({
      where: { receiptId: r.id },
      include: { order: { include: { settlement: true } } },
    });
    if (!h?.order.settlement) continue;
    const payload = combinedReceipt(h, h.order.settlement);
    if (receiptHash(payload) !== r.payloadHash) continue;
    await db.receipt.update({
      where: { id: r.id },
      data: { payload, userId: h.userId, subjectId: h.orderId },
    });
  }
  return issued;
}

const subjects = async (db: PrismaClient, kind: string) =>
  (await db.receipt.findMany({ where: { kind }, select: { subjectId: true } }))
    .map((r) => r.subjectId)
    .filter((s): s is string => !!s);
