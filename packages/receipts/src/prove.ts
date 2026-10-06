// PRD 10.2 — "prove" exports for one receipt:
//   Tempo   payout / anchor tx + memo (+ explorer link)
//   Solana  payout-commitment opening (amount, salt) for the Position PDA, and the compliance
//           auditor's signed attestation of the confidential escrow → user transfer amount (3.5)
//   Zcash   per-payout OVK view + FROST 2-of-3 signature check (7.7)
// The bundle is cached on Receipt.proof: attestations are signed statements, not recomputed.
import type { Prisma, PrismaClient } from '@tyr/db';
import { attestTransfer, explorer, type Attestation } from '@tyr/solana';
import { explorerTx, memo32 } from '@tyr/tempo';
import { zcashDisclosure } from '@tyr/zcash';
import type { Hex } from 'viem';

type Signature = Parameters<typeof attestTransfer>[0];

export type ReceiptRow = Prisma.ReceiptGetPayload<object>;

type SolanaLeg = { settleTx: string; escrowPayTx: string | null } | null;
type Payload = {
  kind: string;
  orderId?: string;
  orderTxid?: string;
  solana?: SolanaLeg;
  tempo?: { payoutTx: Hex; memo: Hex } | null;
  bet?: {
    solana?: SolanaLeg;
    solanaSettleTx?: string | null;
    solanaPayTx?: string | null;
    tempoPayoutTx?: Hex | null;
    tempoMemo?: Hex | null;
  } | null;
  hedge?: { solanaDebitTx: string | null; solanaPayTx: string | null };
};

export type Proof = {
  receiptId: string;
  kind: string;
  payloadHash: string;
  provedAt: string;
  tempo: { label: string; tx: Hex; memo: Hex; explorer: string }[];
  solana: {
    settleTx: string | null;
    opening: { amountUnits: string; salt: string } | null;
    attestations: { label: string; tx: string; explorer: string; attestation: Attestation }[];
  } | null;
  zcash: Awaited<ReturnType<typeof zcashDisclosure>> | null;
};

/** Payout opening for the Position PDA's payout_commitment (Phase 3 kept the salt for this). */
async function opening(db: PrismaClient, orderId: string | null | undefined) {
  if (!orderId) return null;
  const s = await db.settlement.findUnique({ where: { orderId } });
  if (!s?.payoutSalt) return null;
  return {
    amountUnits: BigInt(Math.floor(Number(s.payoutUsd) * 1e6 + 1e-6)).toString(),
    salt: s.payoutSalt,
  };
}

async function attest(label: string, tx: string | null | undefined) {
  if (!tx) return [];
  return [
    { label, tx, explorer: explorer(tx), attestation: await attestTransfer(tx as Signature) },
  ];
}

/** Build (or return the cached) proof bundle for a receipt. */
export async function proveReceipt(db: PrismaClient, r: ReceiptRow): Promise<Proof> {
  if (r.proof) return r.proof as unknown as Proof;
  const p = r.payload as unknown as Payload | null;
  if (!p) throw new Error(`receipt ${r.id} has no payload`);

  const tempo: Proof['tempo'] = [];
  let solana: Proof['solana'] = null;
  let zcash: Proof['zcash'] = null;

  if (p.kind === 'bet') {
    if (p.tempo)
      tempo.push({
        label: 'stake refund payout',
        tx: p.tempo.payoutTx,
        memo: p.tempo.memo,
        explorer: explorerTx(p.tempo.payoutTx),
      });
    if (p.solana)
      solana = {
        settleTx: p.solana.settleTx,
        opening: await opening(db, p.orderId),
        attestations: await attest('escrow → user payout', p.solana.escrowPayTx),
      };
  } else if (p.kind === 'zcash-payout') {
    zcash = p.orderTxid ? await zcashDisclosure(db, p.orderTxid) : null;
    const leg = p.bet?.solana;
    if (leg)
      solana = { settleTx: leg.settleTx, opening: await opening(db, p.orderId), attestations: [] };
  } else if (p.kind === 'bet+hedge') {
    const anchor = await db.hedge.findUnique({ where: { receiptId: r.id } });
    if (anchor?.receiptTx)
      tempo.push({
        label: 'receipt anchor',
        tx: anchor.receiptTx as Hex,
        memo: memo32(`receipt:${r.id}`),
        explorer: explorerTx(anchor.receiptTx as Hex),
      });
    if (p.bet?.tempoPayoutTx && p.bet.tempoMemo)
      tempo.push({
        label: 'stake refund payout',
        tx: p.bet.tempoPayoutTx,
        memo: p.bet.tempoMemo,
        explorer: explorerTx(p.bet.tempoPayoutTx),
      });
    solana = {
      settleTx: p.bet?.solanaSettleTx ?? null,
      opening: await opening(db, p.orderId),
      attestations: [
        ...(await attest('bet escrow → user payout', p.bet?.solanaPayTx)),
        ...(await attest('hedge user → escrow debit', p.hedge?.solanaDebitTx)),
        ...(await attest('hedge escrow → user payout', p.hedge?.solanaPayTx)),
      ],
    };
  } else throw new Error(`unknown receipt kind ${p.kind}`);

  const proof: Proof = {
    receiptId: r.id,
    kind: r.kind,
    payloadHash: r.payloadHash,
    provedAt: new Date().toISOString(),
    tempo,
    solana,
    zcash,
  };
  await db.receipt.update({
    where: { id: r.id },
    data: { proof: JSON.parse(JSON.stringify(proof)) as Prisma.InputJsonValue },
  });
  return proof;
}
