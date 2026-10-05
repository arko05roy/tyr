// PRD 6.1 / 6.2 / 6.5 — EVM deposits.
//  USDC: the watcher scans Circle USDC `Transfer` logs to deposit addresses up to head − N blocks.
//  ETH:  native transfers emit no log, and full-block scans of fast L2s are too heavy for public
//        RPCs, so ETH deposits are claimed by tx hash (the wallet returns it on send) and verified
//        on-chain: success receipt, `to` = the user's deposit address, N confirmations.
import type { PrismaClient } from '@tyr/db';
import { erc20Abi, getAbiItem, getAddress, parseEventLogs, type Address, type Hash } from 'viem';
import { evmClient, evmSource, evmSources, type EvmSource, type EvmSourceKey } from './chains.js';
import { ethUsd, fxRateNumber, weiToUsdMicro } from './fx.js';
import { getCursor, recordDeposit, setCursor } from './ledger.js';

const transferEvent = getAbiItem({ abi: erc20Abi, name: 'Transfer' });

async function depositOwners(db: PrismaClient): Promise<Map<Address, string>> {
  const rows = await db.depositAddress.findMany({ where: { chain: 'evm' } });
  return new Map(rows.map((r) => [getAddress(r.address), r.userId]));
}

/** One watcher pass over a chain's USDC transfers. Returns recorded deposit ids. */
export async function scanEvmUsdc(db: PrismaClient, key: EvmSourceKey): Promise<string[]> {
  const src = evmSource(key);
  if (!src.usdc) return [];
  const client = evmClient(src);
  const cursorKey = `evm:${key}:usdc`;
  const safe = (await client.getBlockNumber()) - BigInt(src.confirmations);
  const prev = await getCursor(db, cursorKey);
  let from = prev ? BigInt(prev) + 1n : safe - src.lookback;
  if (from > safe) return [];
  const owners = await depositOwners(db);
  if (owners.size === 0) {
    await setCursor(db, cursorKey, safe.toString());
    return [];
  }
  const ids: string[] = [];
  while (from <= safe) {
    const to = from + src.logChunk - 1n < safe ? from + src.logChunk - 1n : safe;
    const logs = await client.getLogs({
      address: src.usdc,
      event: transferEvent,
      args: { to: [...owners.keys()] },
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    for (const log of logs) {
      const userId = owners.get(getAddress(log.args.to));
      if (!userId) continue;
      const d = await recordDeposit(db, {
        userId,
        sourceChain: key,
        sourceTx: log.transactionHash,
        logIndex: log.logIndex,
        asset: 'USDC',
        rawAmount: log.args.value,
        usdMicro: log.args.value, // USDC and tyrUSD are both 6 decimals
      });
      if (d) ids.push(d.id);
    }
    await setCursor(db, cursorKey, to.toString());
    from = to + 1n;
  }
  return ids;
}

export async function scanAllEvm(db: PrismaClient, log: Pick<Console, 'error'> = console) {
  const ids: string[] = [];
  for (const src of Object.values(evmSources())) {
    if (!src.usdc || !process.env[src.rpcEnv]) continue;
    try {
      ids.push(...(await scanEvmUsdc(db, src.key)));
    } catch (e) {
      log.error(`evm scan ${src.key} failed: ${(e as Error).message}`);
    }
  }
  return ids;
}

export class DepositClaimError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'pending' | 'failed' | 'no_deposit',
  ) {
    super(message);
  }
}

/**
 * Claim a deposit by source tx hash (ETH, or USDC ahead of the next watcher pass). Verified
 * entirely from chain state; idempotent with the watcher (same unique key per transfer).
 */
export async function claimEvmDeposit(
  db: PrismaClient,
  userId: string,
  key: EvmSourceKey,
  hash: Hash,
) {
  const src: EvmSource = evmSource(key);
  const row = await db.depositAddress.findUnique({
    where: { userId_chain: { userId, chain: 'evm' } },
  });
  if (!row)
    throw new DepositClaimError(
      'no deposit address — GET /api/deposits/addresses first',
      'no_deposit',
    );
  const mine = getAddress(row.address);
  const client = evmClient(src);
  const [tx, receipt, head] = await Promise.all([
    client.getTransaction({ hash }).catch(() => null),
    client.getTransactionReceipt({ hash }).catch(() => null),
    client.getBlockNumber(),
  ]);
  if (!tx) throw new DepositClaimError(`tx ${hash} not found on ${key}`, 'not_found');
  if (!receipt) throw new DepositClaimError(`tx ${hash} not mined yet`, 'pending');
  if (receipt.status !== 'success') throw new DepositClaimError(`tx ${hash} reverted`, 'failed');
  const confs = head - receipt.blockNumber;
  if (confs < BigInt(src.confirmations))
    throw new DepositClaimError(`${confs}/${src.confirmations} confirmations`, 'pending');

  const deposits = [];
  if (tx.to && getAddress(tx.to) === mine && tx.value > 0n) {
    const fx = await ethUsd();
    const d = await recordDeposit(db, {
      userId,
      sourceChain: key,
      sourceTx: hash,
      asset: 'ETH',
      rawAmount: tx.value,
      usdMicro: weiToUsdMicro(tx.value, fx),
      fx: { rate: fxRateNumber(fx), round: fx.roundId.toString() },
    });
    if (d) deposits.push(d);
  }
  if (src.usdc) {
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs });
    for (const l of transfers) {
      if (getAddress(l.address) !== getAddress(src.usdc) || getAddress(l.args.to) !== mine)
        continue;
      const value = l.args.value;
      const d = await recordDeposit(db, {
        userId,
        sourceChain: key,
        sourceTx: hash,
        logIndex: l.logIndex,
        asset: 'USDC',
        rawAmount: value,
        usdMicro: value,
      });
      if (d) deposits.push(d);
    }
  }
  if (!deposits.length)
    throw new DepositClaimError(`tx ${hash} moves no ETH/USDC to ${mine} on ${key}`, 'no_deposit');
  return deposits;
}
