// PRD 6.1 / 6.5 + HUMAN STOP 6 FX rule — live: native test ETH to the deposit address, claimed by
// tx hash and verified on-chain, priced with Chainlink Sepolia ETH/USD, credited on devnet.
// Robinhood Chain testnet (ETH-only source) always runs; Sepolia runs once the sender has gas ETH.
import { afterAll, describe, expect, it } from 'vitest';
import { createWalletClient, http, parseEther } from 'viem';
import { explorer } from '@tyr/solana';
import {
  DepositClaimError,
  claimEvmDeposit,
  creditDeposit,
  depositAddresses,
  ethUsd,
  evmClient,
  evmExplorerTx,
  evmSource,
  weiToUsdMicro,
  type EvmSourceKey,
} from '../src/index.js';
import { bankroll, db, ev, newUser, requireFunds, sender } from './helpers.js';

const VALUE = parseEther('0.0005');

afterAll(() => db.$disconnect());

// Sepolia needs the (owner-waived) funded EVM sender: opt in with RUN_EVM_USDC_TESTS=1.
describe.each<EvmSourceKey>(
  process.env.RUN_EVM_USDC_TESTS ? ['robinhood', 'sepolia'] : ['robinhood'],
)('deposit.%s ETH (live)', (key) => {
  it('claim → on-chain verify → Chainlink price → confidential credit', async () => {
    const src = evmSource(key);
    await requireFunds(src, 0n, VALUE + parseEther('0.0002'));
    const user = await newUser();
    const addrs = await depositAddresses(db, user.id);
    const wallet = createWalletClient({
      account: sender(),
      chain: src.chain,
      transport: http(process.env[src.rpcEnv]),
    });
    const hash = await wallet.sendTransaction({ to: addrs.evm.address, value: VALUE });
    ev(`${key} ETH deposit`, evmExplorerTx(src, hash));
    const client = evmClient(src);
    const receipt = await client.waitForTransactionReceipt({ hash });

    // a tx that isn't to this user's address is rejected
    const other = await newUser();
    await depositAddresses(db, other.id);
    await expect(claimEvmDeposit(db, other.id, key, hash)).rejects.toThrow(
      /confirmations|moves no ETH\/USDC/,
    );

    // wait for N confirmations (claim says `pending` until then)
    let recorded;
    for (;;) {
      try {
        recorded = await claimEvmDeposit(db, user.id, key, hash);
        break;
      } catch (e) {
        if (!(e instanceof DepositClaimError) || e.code !== 'pending') throw e;
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }
    expect(recorded).toHaveLength(1);
    const fx = await ethUsd();
    const d0 = recorded[0];
    if (!d0) throw new Error('no deposit recorded');
    expect(d0.asset).toBe('ETH');
    expect(d0.rawAmount).toBe(VALUE.toString());
    expect(d0.fxRound).toBeTruthy();
    // priced from the Chainlink round at claim time (same round now, or the next one)
    const expected = weiToUsdMicro(VALUE, fx);
    expect(Math.abs(Number(d0.amount) * 1e6 - Number(expected))).toBeLessThan(
      Number(expected) / 50,
    );

    const d = await creditDeposit(db, d0.id);
    expect(d.status).toBe('credited');
    ev(`${key} ETH → devnet CT deposit`, explorer(d.solanaTx ?? ''));
    expect(await bankroll(user.id)).toBe(BigInt(Math.round(Number(d.amount) * 1e6)));

    // repeat claim is idempotent (no second Deposit, no second mint)
    await claimEvmDeposit(db, user.id, key, hash);
    expect(await db.deposit.count({ where: { sourceTx: hash } })).toBe(1);
    expect(receipt.status).toBe('success');
  }, 600_000);
});
