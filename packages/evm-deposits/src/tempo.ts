// PRD 6.4 — Tempo → Solana: the user sends AlphaUSD to tyr's Tempo treasury with
// `transferWithMemo(memo = tempoDepositMemo(userId))`; the watcher maps the memo to the user and
// credits the confidential bankroll. Stake authorizations use different memos and never match.
import type { PrismaClient } from '@tyr/db';
import { ALPHA_USD, publicClient, treasuryAccount } from '@tyr/tempo';
import { getAbiItem, type Hex } from 'viem';
import { Abis } from 'viem/tempo';
import { getCursor, recordDeposit, setCursor } from './ledger.js';

const transferWithMemo = getAbiItem({ abi: Abis.tip20, name: 'TransferWithMemo' });
const CURSOR = 'tempo:deposits';
const CHUNK = 5_000n;
const LOOKBACK = 2_000n;

export async function scanTempoDeposits(db: PrismaClient): Promise<string[]> {
  const client = publicClient();
  const head = await client.getBlockNumber();
  const prev = await getCursor(db, CURSOR);
  let from = prev ? BigInt(prev) + 1n : head - LOOKBACK;
  if (from > head) return [];
  const memos = new Map(
    (await db.depositAddress.findMany({ where: { chain: 'tempo' } })).map((r) => [
      r.address.toLowerCase(),
      r.userId,
    ]),
  );
  const ids: string[] = [];
  while (from <= head) {
    const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
    if (memos.size) {
      const logs = await client.getLogs({
        address: ALPHA_USD,
        event: transferWithMemo,
        args: { to: treasuryAccount().address, memo: [...memos.keys()] as Hex[] },
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
      for (const log of logs) {
        const userId = memos.get(log.args.memo.toLowerCase());
        if (!userId) continue;
        const d = await recordDeposit(db, {
          userId,
          sourceChain: 'tempo',
          sourceTx: log.transactionHash,
          logIndex: log.logIndex,
          asset: 'AlphaUSD',
          rawAmount: log.args.amount,
          usdMicro: log.args.amount, // AlphaUSD and tyrUSD are both 6 decimals
        });
        if (d) ids.push(d.id);
      }
    }
    await setCursor(db, CURSOR, to.toString());
    from = to + 1n;
  }
  return ids;
}
