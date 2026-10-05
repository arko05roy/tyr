// PRD 2.6 — receipt indexer: TIP-20 TransferWithMemo events to/from tyr addresses.
import type { PrismaClient } from '@tyr/db';
import { getAbiItem, type Address, type Log } from 'viem';
import { Abis } from 'viem/tempo';
import { ALPHA_USD, fromUsd, publicClient } from './chain.js';

const transferWithMemo = getAbiItem({ abi: Abis.tip20, name: 'TransferWithMemo' });

type MemoLog = Log<bigint, number, false, typeof transferWithMemo, true>;

async function persist(db: PrismaClient, logs: MemoLog[]): Promise<number> {
  let n = 0;
  for (const log of logs) {
    const { from, to, amount, memo } = log.args;
    const mapping = await db.payoutMemo.findUnique({ where: { memo } });
    await db.tempoTransfer.upsert({
      where: { txHash_logIndex: { txHash: log.transactionHash, logIndex: log.logIndex } },
      create: {
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        token: log.address,
        from,
        to,
        amount: fromUsd(amount),
        memo,
        settlementId: mapping?.settlementId ?? null,
      },
      update: {},
    });
    n++;
  }
  return n;
}

/** Backfill a block range for events touching `addresses` (as sender or recipient). */
export async function indexRange(
  db: PrismaClient,
  params: { addresses: Address[]; fromBlock: bigint; toBlock: bigint; token?: Address },
): Promise<number> {
  const client = publicClient();
  const token = params.token ?? ALPHA_USD;
  const [sent, received] = await Promise.all([
    client.getLogs({
      address: token,
      event: transferWithMemo,
      args: { from: params.addresses },
      fromBlock: params.fromBlock,
      toBlock: params.toBlock,
      strict: true,
    }),
    client.getLogs({
      address: token,
      event: transferWithMemo,
      args: { to: params.addresses },
      fromBlock: params.fromBlock,
      toBlock: params.toBlock,
      strict: true,
    }),
  ]);
  return persist(db, [...sent, ...received] as MemoLog[]);
}

/** Live subscription (worker). Returns an unwatch function. */
export function watchMemos(db: PrismaClient, addresses: Address[], onError?: (e: Error) => void) {
  const client = publicClient();
  return client.watchContractEvent({
    address: ALPHA_USD,
    abi: [transferWithMemo],
    eventName: 'TransferWithMemo',
    args: { to: addresses },
    strict: true,
    onLogs: (logs) => void persist(db, logs as MemoLog[]).catch((e) => onError?.(e as Error)),
    ...(onError ? { onError } : {}),
  });
}
