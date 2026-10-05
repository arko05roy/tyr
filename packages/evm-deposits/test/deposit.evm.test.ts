// PRD 6.1 / 6.2 — live: real Circle testnet USDC → per-user HD deposit address on Sepolia, Base
// Sepolia and Arb Sepolia → watcher (head − N confirmations) → treasury mints tyrUSD → CT deposit
// → owner-decrypted bankroll increases by exactly the deposit; Deposit.status = credited.
import { afterAll, describe, expect, it } from 'vitest';
import { createWalletClient, erc20Abi, http, parseEther } from 'viem';
import { explorer } from '@tyr/solana';
import {
  depositAddresses,
  evmExplorerTx,
  evmSource,
  scanEvmUsdc,
  type EvmSourceKey,
} from '../src/index.js';
import { bankroll, db, ev, newUser, requireFunds, sender, untilCredited } from './helpers.js';

const AMOUNT = 1_000_000n; // 1 USDC

afterAll(() => db.$disconnect());

// Owner waived funding the EVM test sender (2026-10-06): opt in with RUN_EVM_USDC_TESTS=1.
describe
  .skipIf(!process.env.RUN_EVM_USDC_TESTS)
  .each<EvmSourceKey>(['sepolia', 'baseSepolia', 'arbSepolia'])('deposit.%s (live)', (key) => {
  it('USDC transfer to the deposit address is credited to the confidential bankroll', async () => {
    const src = evmSource(key);
    const usdc = src.usdc;
    if (!usdc) throw new Error(`${key} has no USDC`);
    await requireFunds(src, AMOUNT, parseEther('0.0002'));
    const user = await newUser();
    const addrs = await depositAddresses(db, user.id);
    expect(await bankroll(user.id)).toBe(0n);

    const wallet = createWalletClient({
      account: sender(),
      chain: src.chain,
      transport: http(process.env[src.rpcEnv]),
    });
    const hash = await wallet.writeContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [addrs.evm.address, AMOUNT],
    });
    ev(`${key} USDC deposit`, evmExplorerTx(src, hash));

    const d = await untilCredited(() => scanEvmUsdc(db, key), hash);
    expect(d.userId).toBe(user.id);
    expect(d.asset).toBe('USDC');
    expect(d.rawAmount).toBe(AMOUNT.toString());
    expect(Number(d.amount)).toBe(1);
    expect(d.mintTx && d.solanaTx).toBeTruthy();
    ev(`${key} → devnet tyrUSD mint`, explorer(d.mintTx ?? ''));
    ev(`${key} → devnet CT deposit`, explorer(d.solanaTx ?? ''));
    expect(await bankroll(user.id)).toBe(AMOUNT);

    // idempotent: a re-scan of the same range records nothing new
    await scanEvmUsdc(db, key);
    expect(await db.deposit.count({ where: { sourceTx: hash } })).toBe(1);
  }, 600_000);
});
