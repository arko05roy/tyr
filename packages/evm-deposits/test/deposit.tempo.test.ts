// PRD 6.4 — live: AlphaUSD transferWithMemo(treasury, memo = user deposit memo) on Moderato →
// watcher maps memo → user → tyrUSD credited on devnet. A wrong memo credits nobody.
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, http, publicActions, walletActions, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Abis } from 'viem/tempo';
import { explorer } from '@tyr/solana';
import { ALPHA_USD, chain, explorerTx, rpcUrl, usd } from '@tyr/tempo';
import { fund } from '../../tempo/test/helpers.js';
import { depositAddresses, scanTempoDeposits } from '../src/index.js';
import { bankroll, db, ev, newUser, untilCredited } from './helpers.js';

afterAll(() => db.$disconnect());

describe('deposit.tempo (live Moderato → devnet)', () => {
  it('memo-tagged AlphaUSD to the treasury credits the matching user', async () => {
    const user = await newUser();
    const addrs = await depositAddresses(db, user.id);
    const payer = privateKeyToAccount(generatePrivateKey());
    await fund(payer.address, usd(5)); // AlphaUSD also pays Tempo fees (feeToken)
    const wallet = createClient({ account: payer, chain, transport: http(rpcUrl()) })
      .extend(publicActions)
      .extend(walletActions);
    const send = async (memo: Hex) => {
      const hash = await wallet.writeContract({
        address: ALPHA_USD,
        abi: Abis.tip20,
        functionName: 'transferWithMemo',
        args: [addrs.tempo.to, usd(2), memo],
      } as never);
      expect((await wallet.waitForTransactionReceipt({ hash })).status).toBe('success');
      return hash;
    };
    const stray = await send(`0x${'ab'.repeat(32)}`);
    const hash = await send(addrs.tempo.memo);
    ev('tempo memo deposit', explorerTx(hash));

    const d = await untilCredited(() => scanTempoDeposits(db), hash, 120_000);
    expect(d.userId).toBe(user.id);
    expect(d.asset).toBe('AlphaUSD');
    expect(Number(d.amount)).toBe(2);
    ev('tempo → devnet CT deposit', explorer(d.solanaTx ?? ''));
    expect(await bankroll(user.id)).toBe(usd(2));
    expect(await db.deposit.count({ where: { sourceTx: stray } })).toBe(0);
  });
});
