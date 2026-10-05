// BullMQ funding-router tick on real Redis: a live Moderato memo deposit is detected and credited
// on devnet by the worker alone (no direct scan/credit calls from the test).
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@tyr/db';
import { depositAddresses } from '@tyr/evm-deposits';
import { ALPHA_USD, chain, rpcUrl, usd } from '@tyr/tempo';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, http, publicActions, walletActions } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Abis } from 'viem/tempo';
import { fund, registerUser } from '../../../packages/tempo/test/helpers.js';
import { startFunding } from '../src/queues.js';

const db = new PrismaClient();
afterAll(() => db.$disconnect());

describe('funding queue (Redis + live Moderato + devnet)', () => {
  it('the repeatable tick credits a Tempo memo deposit', async () => {
    const { user } = await registerUser();
    const addrs = await depositAddresses(db, user.id);
    const payer = privateKeyToAccount(generatePrivateKey());
    await fund(payer.address, usd(3));
    const wallet = createClient({ account: payer, chain, transport: http(rpcUrl()) })
      .extend(publicActions)
      .extend(walletActions);
    const hash = await wallet.writeContract({
      address: ALPHA_USD,
      abi: Abis.tip20,
      functionName: 'transferWithMemo',
      args: [addrs.tempo.to, usd(1), addrs.tempo.memo],
    } as never);
    await wallet.waitForTransactionReceipt({ hash });

    const s = await startFunding(db, {
      redisUrl: process.env.REDIS_URL ?? '',
      everyMs: 5_000,
      queueName: `funding-test-${randomUUID()}`,
    });
    try {
      const end = Date.now() + 120_000;
      let d = await db.deposit.findFirst({ where: { sourceTx: hash } });
      while (d?.status !== 'credited' && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 3_000));
        d = await db.deposit.findFirst({ where: { sourceTx: hash } });
      }
      expect(d?.status).toBe('credited');
      expect(d?.userId).toBe(user.id);
    } finally {
      await s.close();
    }
  });
});
