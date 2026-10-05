// One funding-router tick: scan every source for confirmed transfers, then credit them on Solana.
import type { PrismaClient } from '@tyr/db';
import { scanAllEvm } from './evm.js';
import { creditPending } from './ledger.js';
import { scanSolanaUsdc } from './solana.js';
import { scanTempoDeposits } from './tempo.js';

export function fundingWorker(db: PrismaClient, log: Pick<Console, 'error'> = console) {
  const guarded = async (name: string, f: () => Promise<string[]>) => {
    try {
      return await f();
    } catch (e) {
      log.error(`${name} scan failed: ${(e as Error).message}`);
      return [];
    }
  };
  return async function tick() {
    const detected = [
      ...(await scanAllEvm(db, log)),
      ...(await guarded('solana', () => scanSolanaUsdc(db))),
      ...(await guarded('tempo', () => scanTempoDeposits(db))),
    ];
    const credited = await creditPending(db, log);
    return { detected, credited };
  };
}
