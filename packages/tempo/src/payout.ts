// PRD 2.5 — payouts: transferWithMemo(to, amount, memo32) from tyr's treasury; memo ↔ settlement.
import type { PrismaClient } from '@tyr/db';
import type { Address, Hex } from 'viem';
import { transferCall } from './batch.js';
import { ALPHA_USD, treasuryClient } from './chain.js';
import { memo32 } from './memo.js';

export async function payout(
  db: PrismaClient,
  params: { settlementId: string; to: Address; amount: bigint },
): Promise<{ txHash: Hex; memo: Hex }> {
  const memo = memo32(params.settlementId);
  // Record the mapping first (idempotency: one payout memo per settlement).
  const existing = await db.payoutMemo.findUnique({ where: { settlementId: params.settlementId } });
  if (existing?.txHash) return { txHash: existing.txHash as Hex, memo };
  if (!existing) await db.payoutMemo.create({ data: { memo, settlementId: params.settlementId } });

  const client = treasuryClient();
  const txHash = await client.sendTransaction({
    calls: [transferCall(ALPHA_USD, params.to, params.amount, memo)],
  } as never);
  const r = await client.waitForTransactionReceipt({ hash: txHash });
  if (r.status !== 'success') throw new Error(`payout reverted: ${txHash}`);
  await db.payoutMemo.update({ where: { memo }, data: { txHash } });
  return { txHash, memo };
}
