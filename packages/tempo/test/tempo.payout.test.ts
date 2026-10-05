// Live Moderato: payout with memo32(settlementId); indexer maps the on-chain memo back.
import { afterAll, describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { explorerTx, indexRange, memo32, payout, publicClient, usd } from '../src/index.js';
import { db, registerUser } from './helpers.js';

describe('tempo payout + indexer (live Moderato)', () => {
  afterAll(() => db.$disconnect());

  it('pays out with memo and the indexer resolves it to the settlement', async () => {
    const { user } = await registerUser();
    const settlementId = `settle-${Date.now()}`;
    const fromBlock = await publicClient().getBlockNumber();

    const { txHash, memo } = await payout(db, {
      settlementId,
      to: user.tempoAddress as Address,
      amount: usd(1.25),
    });
    console.log('payout', explorerTx(txHash));
    expect(memo).toBe(memo32(settlementId));

    // idempotent: same settlement → same tx, no second transfer
    expect(
      (await payout(db, { settlementId, to: user.tempoAddress as Address, amount: usd(1.25) }))
        .txHash,
    ).toBe(txHash);

    const toBlock = await publicClient().getBlockNumber();
    const n = await indexRange(db, {
      addresses: [user.tempoAddress as Address],
      fromBlock,
      toBlock,
    });
    expect(n).toBeGreaterThanOrEqual(1);
    const row = await db.tempoTransfer.findFirstOrThrow({ where: { txHash } });
    expect(row.memo).toBe(memo);
    expect(row.settlementId).toBe(settlementId);
    expect(Number(row.amount)).toBe(1.25);
  });
});
