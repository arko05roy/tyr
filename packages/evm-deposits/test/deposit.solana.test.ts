// PRD 6.3 — live devnet: Circle devnet USDC sent (as Phantom would) to the user's deposit owner
// address → lands in its USDC ATA → watcher reads the finalized transfer → tyrUSD credited.
import { afterAll, describe, expect, it } from 'vitest';
import {
  findAssociatedTokenPda,
  getTransferToATAInstructionPlanAsync,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { explorer, sendPlan, signerFromFile, solana } from '@tyr/solana';
import { SOLANA_DEVNET_USDC, depositAddresses, scanSolanaUsdc } from '../src/index.js';
import { bankroll, db, ev, newUser, untilCredited } from './helpers.js';

const AMOUNT = 1_000_000n; // 1 USDC

afterAll(() => db.$disconnect());

describe('deposit.solana (live devnet)', () => {
  it('devnet USDC to the deposit address is credited to the confidential bankroll', async () => {
    const payer = await signerFromFile(process.env.SOLANA_TEST_SENDER_KEYPAIR ?? '');
    const [source] = await findAssociatedTokenPda({
      owner: payer.address,
      mint: SOLANA_DEVNET_USDC,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const have = await solana()
      .rpc.getTokenAccountBalance(source)
      .send()
      .then((r) => BigInt(r.value.amount))
      .catch(() => 0n);
    if (have < AMOUNT)
      throw new Error(
        `test sender ${payer.address} has ${have} devnet USDC base units; fund it at faucet.circle.com (Solana Devnet)`,
      );

    const user = await newUser();
    const addrs = await depositAddresses(db, user.id);
    const plan = await getTransferToATAInstructionPlanAsync({
      payer,
      mint: SOLANA_DEVNET_USDC,
      source,
      authority: payer,
      recipient: addrs.solana.owner,
      amount: AMOUNT,
      decimals: 6,
    });
    const sigs = await sendPlan(plan, payer);
    const sig = sigs.at(-1);
    if (!sig) throw new Error('transfer not sent');
    ev('solana USDC deposit', explorer(sig));

    const d = await untilCredited(() => scanSolanaUsdc(db), sig, 180_000);
    expect(d.userId).toBe(user.id);
    expect(d.sourceChain).toBe('solanaDevnet');
    expect(Number(d.amount)).toBe(1);
    ev('solana USDC → CT deposit', explorer(d.solanaTx ?? ''));
    expect(await bankroll(user.id)).toBe(AMOUNT);
  }, 300_000);
});
