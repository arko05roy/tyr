// PRD 2.6 worker: index TransferWithMemo events touching tyr's treasury (stakes in, payouts out).
// Backfills from the last indexed block on boot, then follows the chain live.
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@tyr/db';
import { indexRange, publicClient, treasuryAccount, watchMemos } from '@tyr/tempo';

loadDotenv({ path: new URL('../../../.env', import.meta.url) });
const db = new PrismaClient();
const treasury = treasuryAccount().address;

const last = await db.tempoTransfer.findFirst({ orderBy: { blockNumber: 'desc' } });
const head = await publicClient().getBlockNumber();
const from = last ? last.blockNumber + 1n : head - 10_000n;
const n = await indexRange(db, { addresses: [treasury], fromBlock: from, toBlock: head });
console.log(`backfilled ${n} memo transfers (${from}..${head}) for ${treasury}`);

watchMemos(db, [treasury], (e) => console.error('indexer error', e.message));
console.log('watching TransferWithMemo live…');
