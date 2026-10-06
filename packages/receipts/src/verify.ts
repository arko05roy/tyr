// PRD 10.3 — verify a receipt by reading the chains directly, not tyr's database:
//   hash      keccak256(canonicalJson(payload)) == payloadHash
//   Tempo     the tx succeeded and emitted TIP-20 TransferWithMemo(token, to, amount, memo)
//   Solana    settle tx confirmed; Position PDA settled with the receipt's outcome and
//             payout_commitment; the (amount, salt) opening matches it; CT txs move between the
//             expected accounts; auditor attestations verify and match the tx + payout amount
//   Zcash     OVK view of the payout equals the FROST-signed instruction, signature valid
// The only DB reads are the receipt itself, the commitment opening and the bet owner's address.
import type { PrismaClient } from '@tyr/db';
import { OUTCOME, confidentialAccount, units } from '@tyr/pipeline';
import {
  amountCommitment,
  ataOf,
  escrowKeys,
  fetchPosition,
  fetchTransferData,
  orderId32,
  solana,
  verifyAttestation,
  type Attestation,
} from '@tyr/solana';
import { ALPHA_USD, memo32, publicClient } from '@tyr/tempo';
import { zcashDisclosure } from '@tyr/zcash';
import { parseEventLogs, type Hex } from 'viem';
import { Abis } from 'viem/tempo';
import { receiptHash } from './issue.js';
import type { Proof, ReceiptRow } from './prove.js';

export type Check = { name: string; ok: boolean; detail?: string };
export type Verification = { receiptId: string; kind: string; ok: boolean; checks: Check[] };

type Signature = Parameters<typeof fetchTransferData>[0];
type SolAddress = Awaited<ReturnType<typeof ataOf>>;
const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString('hex')}`;
const lc = (s: string) => s.toLowerCase();

async function check(checks: Check[], name: string, fn: () => Promise<true | string>) {
  try {
    const r = await fn();
    checks.push(r === true ? { name, ok: true } : { name, ok: false, detail: r });
  } catch (e) {
    checks.push({ name, ok: false, detail: (e as Error).message });
  }
}

/** Tempo: tx succeeded and carries TransferWithMemo with these fields (amount optional). */
async function tempoMemo(tx: Hex, want: { to: string; memo: Hex; amount?: bigint }) {
  const r = await publicClient().getTransactionReceipt({ hash: tx });
  if (r.status !== 'success') return `tx ${tx} reverted`;
  const logs = parseEventLogs({ abi: Abis.tip20, eventName: 'TransferWithMemo', logs: r.logs });
  const hit = logs.find(
    (l) =>
      lc(l.address) === lc(ALPHA_USD) &&
      lc(l.args.to) === lc(want.to) &&
      lc(l.args.memo) === lc(want.memo) &&
      (want.amount === undefined || l.args.amount === want.amount),
  );
  return hit ? true : `no TransferWithMemo(to=${want.to}, memo=${want.memo}) in ${tx}`;
}

async function solanaConfirmed(sig: string) {
  const { value } = await solana()
    .rpc.getSignatureStatuses([sig as Signature], { searchTransactionHistory: true })
    .send();
  const st = value[0];
  if (!st) return `${sig} not found`;
  if (st.err) return `${sig} failed`;
  return st.confirmationStatus === 'processed' ? `${sig} only processed` : true;
}

/** Position PDA: settled, expected outcome, payout_commitment opens to the payout amount. */
async function positionChecks(
  checks: Check[],
  leg: { owner: SolAddress; orderId32: string; settleTx: string; payoutCommitment?: string },
  outcome: string,
  payoutUsd: number,
  opening: { amountUnits: string; salt: string } | null,
) {
  await check(checks, 'solana.settleTx confirmed', () => solanaConfirmed(leg.settleTx));
  await check(checks, 'solana.position settled', async () => {
    const pos = await fetchPosition(leg.owner, Buffer.from(leg.orderId32.slice(2), 'hex'));
    if (!pos) return 'position PDA not found';
    if (pos.status !== 'settled') return `position is ${pos.status}`;
    const want = OUTCOME[outcome as keyof typeof OUTCOME];
    if (pos.outcome !== want) return `on-chain outcome ${pos.outcome} ≠ ${outcome} (${want})`;
    const onchain = hex(pos.payoutCommitment);
    if (leg.payoutCommitment && onchain !== leg.payoutCommitment)
      return 'payout_commitment differs from receipt';
    if (!opening) return true;
    if (BigInt(opening.amountUnits) !== units(payoutUsd)) return 'opening amount ≠ receipt payout';
    const c = hex(amountCommitment(BigInt(opening.amountUnits), Buffer.from(opening.salt, 'hex')));
    return c === onchain ? true : 'opening does not match on-chain payout_commitment';
  });
}

/** CT tx moves from → to (token accounts); attestation, if any, signs this tx and amount. */
async function ctChecks(
  checks: Check[],
  label: string,
  tx: string,
  from: SolAddress,
  to: SolAddress,
  att: Attestation | undefined,
  amountUnits?: bigint,
) {
  await check(checks, `${label} transfer`, async () => {
    const t = await fetchTransferData(tx as Signature);
    if (t.source !== from) return `source ${t.source} ≠ ${from}`;
    return t.destination === to ? true : `destination ${t.destination} ≠ ${to}`;
  });
  if (!att) return;
  await check(checks, `${label} auditor attestation`, async () => {
    if (!(await verifyAttestation(att))) return 'attestation signature invalid';
    if (att.statement.signature !== tx) return 'attestation is for a different tx';
    if (amountUnits !== undefined && BigInt(att.statement.amount) !== amountUnits)
      return `attested ${att.statement.amount} ≠ payout ${amountUnits}`;
    return true;
  });
}

const attFor = (proof: Proof | null, tx: string | null | undefined) =>
  proof?.solana?.attestations.find((a) => a.tx === tx)?.attestation;

/* eslint-disable @typescript-eslint/no-explicit-any -- payloads are versioned JSON records */
export async function verifyReceipt(db: PrismaClient, r: ReceiptRow): Promise<Verification> {
  const checks: Check[] = [];
  const p = r.payload as any;
  const proof = (r.proof as unknown as Proof | null) ?? null;
  if (!p)
    return {
      receiptId: r.id,
      kind: r.kind,
      ok: false,
      checks: [{ name: 'payload', ok: false, detail: 'missing' }],
    };
  checks.push(
    receiptHash(p) === r.payloadHash
      ? { name: 'payload hash', ok: true }
      : { name: 'payload hash', ok: false, detail: 'payload does not hash to payloadHash' },
  );
  const orderId: string | undefined = p.orderId ?? undefined;
  const opening = async () => {
    if (proof?.solana?.opening) return proof.solana.opening;
    const s = orderId ? await db.settlement.findUnique({ where: { orderId } }) : null;
    return s?.payoutSalt
      ? { amountUnits: units(Number(s.payoutUsd)).toString(), salt: s.payoutSalt }
      : null;
  };
  const escrowAta = async () => ataOf((await escrowKeys()).owner.address);

  if (p.kind === 'bet') {
    if (p.tempo)
      await check(checks, 'tempo payout memo', () =>
        tempoMemo(p.tempo.payoutTx, {
          to: p.tempo.to,
          memo: p.tempo.memo,
          amount: BigInt(p.tempo.amount),
        }),
      );
    if (p.tempo && p.tempo.memo !== memo32(p.orderId))
      checks.push({
        name: 'tempo memo binds order',
        ok: false,
        detail: 'memo ≠ keccak256(orderId)',
      });
    if (p.solana) {
      await positionChecks(checks, p.solana, p.outcome, p.payoutUsd, await opening());
      if (p.solana.escrowPayTx)
        await ctChecks(
          checks,
          'solana escrow → user',
          p.solana.escrowPayTx,
          await escrowAta(),
          await ataOf(p.solana.owner),
          attFor(proof, p.solana.escrowPayTx),
          units(p.payoutUsd),
        );
    }
  } else if (p.kind === 'bet+hedge') {
    const user = r.userId ? await db.user.findUnique({ where: { id: r.userId } }) : null;
    const owner = r.userId ? (await confidentialAccount(db, r.userId)).owner.address : null;
    const anchor =
      proof?.tempo.find((t) => t.label === 'receipt anchor')?.tx ??
      ((await db.hedge.findUnique({ where: { receiptId: r.id } }))?.receiptTx as Hex | undefined);
    if (!user || !owner) checks.push({ name: 'owner', ok: false, detail: 'receipt has no owner' });
    else {
      await check(checks, 'tempo receipt anchor', async () =>
        anchor
          ? tempoMemo(anchor, {
              to: user.tempoAddress,
              memo: memo32(`receipt:${r.id}`),
              amount: 0n,
            })
          : 'no anchor tx',
      );
      if (p.bet.tempoPayoutTx)
        await check(checks, 'tempo bet payout memo', () =>
          tempoMemo(p.bet.tempoPayoutTx, { to: user.tempoAddress, memo: memo32(p.orderId) }),
        );
      if (p.bet.solanaSettleTx) {
        await positionChecks(
          checks,
          { owner, orderId32: hex(orderId32(p.orderId)), settleTx: p.bet.solanaSettleTx },
          p.bet.outcome,
          p.bet.payoutUsd,
          await opening(),
        );
      }
      const [esc, mine] = [await escrowAta(), await ataOf(owner)];
      if (p.bet.solanaPayTx)
        await ctChecks(
          checks,
          'solana bet escrow → user',
          p.bet.solanaPayTx,
          esc,
          mine,
          attFor(proof, p.bet.solanaPayTx),
          units(p.bet.payoutUsd),
        );
      if (p.hedge.solanaDebitTx)
        await ctChecks(
          checks,
          'solana hedge user → escrow',
          p.hedge.solanaDebitTx,
          mine,
          esc,
          attFor(proof, p.hedge.solanaDebitTx),
          units(p.hedge.amountInUsd),
        );
      if (p.hedge.solanaPayTx)
        await ctChecks(
          checks,
          'solana hedge escrow → user',
          p.hedge.solanaPayTx,
          esc,
          mine,
          attFor(proof, p.hedge.solanaPayTx),
          units(p.hedge.valueUsd),
        );
    }
  } else if (p.kind === 'zcash-payout') {
    await check(checks, 'zcash payout view + FROST', async () => {
      const d = await zcashDisclosure(db, p.orderTxid);
      if (!d) return 'no disclosure (payout not sent)';
      if (d.payoutTxid !== p.payout.txid) return 'payout txid differs from receipt';
      if (d.instruction.to !== p.payout.to || String(d.instruction.zat) !== p.payout.zat)
        return 'signed instruction differs from receipt';
      if (!d.frost.valid) return 'FROST signature invalid';
      return d.matches ? true : 'decrypted output does not match the signed instruction';
    });
    if (p.bet?.solana)
      await positionChecks(checks, p.bet.solana, p.bet.outcome, p.bet.payoutUsd, await opening());
  } else checks.push({ name: 'kind', ok: false, detail: `unknown kind ${p.kind}` });

  return { receiptId: r.id, kind: r.kind, ok: checks.every((c) => c.ok), checks };
}
