// Shared bookkeeping for every funding source: watcher cursors, recording a confirmed source-chain
// transfer as a Deposit, and PRD 6.2 crediting (treasury mints tyrUSD → user CT deposit → apply).
import type { PrismaClient } from '@tyr/db';
import { confidentialAccount, emit, fromUnits } from '@tyr/pipeline';
import { applyPending, ataOf, deposit, loadToken, mintPublic } from '@tyr/solana';

export async function getCursor(db: PrismaClient, key: string): Promise<string | null> {
  return (await db.scanCursor.findUnique({ where: { key } }))?.value ?? null;
}

export async function setCursor(db: PrismaClient, key: string, value: string) {
  await db.scanCursor.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export type SourceTransfer = {
  userId: string;
  sourceChain: string;
  sourceTx: string;
  logIndex?: number;
  asset: 'USDC' | 'ETH' | 'AlphaUSD';
  rawAmount: bigint;
  usdMicro: bigint;
  fx?: { rate: number; round: string };
};

/** Idempotent on (sourceChain, sourceTx, logIndex): a re-scan or a repeat claim is a no-op. */
export async function recordDeposit(db: PrismaClient, t: SourceTransfer) {
  if (t.usdMicro <= 0n) return null;
  const logIndex = t.logIndex ?? -1;
  const d = await db.deposit.upsert({
    where: {
      sourceChain_sourceTx_logIndex: { sourceChain: t.sourceChain, sourceTx: t.sourceTx, logIndex },
    },
    create: {
      userId: t.userId,
      sourceChain: t.sourceChain,
      sourceTx: t.sourceTx,
      logIndex,
      asset: t.asset,
      rawAmount: t.rawAmount.toString(),
      amount: fromUnits(t.usdMicro),
      fxRate: t.fx?.rate ?? null,
      fxRound: t.fx?.round ?? null,
      status: 'confirmed',
    },
    update: {},
  });
  if (d.status === 'confirmed')
    emit({
      type: 'deposit',
      userId: d.userId,
      depositId: d.id,
      sourceChain: d.sourceChain,
      status: d.status,
      amountUsd: Number(d.amount),
    });
  return d;
}

const toMicro = (amount: { toString(): string }) =>
  BigInt(Math.round(Number(amount.toString()) * 1e6));

/**
 * PRD 6.2: confirmed → minted (treasury mints public tyrUSD into the user's ATA) → credited
 * (public → pending → available confidential balance). Each step's tx is persisted before the
 * next, so a crashed tick resumes without minting twice.
 */
export async function creditDeposit(db: PrismaClient, depositId: string) {
  let d = await db.deposit.findUniqueOrThrow({ where: { id: depositId } });
  if (d.status === 'credited') return d;
  const amount = toMicro(d.amount);
  const keys = await confidentialAccount(db, d.userId);
  const ata = await ataOf(keys.owner.address);
  if (d.status === 'confirmed') {
    const mintTx = await mintPublic(ata, amount);
    d = await db.deposit.update({ where: { id: d.id }, data: { status: 'minted', mintTx } });
  }
  const pub = (await loadToken(ata)).amount;
  if (pub < amount)
    throw new Error(`deposit ${d.id}: public tyrUSD ${pub} < ${amount}; CT deposit already sent?`);
  const solanaTx = await deposit(keys, amount);
  await applyPending(keys);
  d = await db.deposit.update({
    where: { id: d.id },
    data: { status: 'credited', solanaTx, creditedAt: new Date() },
  });
  emit({
    type: 'deposit',
    userId: d.userId,
    depositId: d.id,
    sourceChain: d.sourceChain,
    status: d.status,
    amountUsd: Number(d.amount),
  });
  return d;
}

export async function creditPending(db: PrismaClient, log: Pick<Console, 'error'> = console) {
  const pending = await db.deposit.findMany({
    where: { status: { in: ['confirmed', 'minted'] } },
    orderBy: { createdAt: 'asc' },
  });
  const credited: string[] = [];
  for (const d of pending) {
    try {
      await creditDeposit(db, d.id);
      credited.push(d.id);
    } catch (e) {
      log.error(`credit ${d.id} failed: ${(e as Error).message}`);
    }
  }
  return credited;
}
