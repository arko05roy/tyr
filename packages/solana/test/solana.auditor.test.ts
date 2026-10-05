import { describe, expect, it, beforeAll } from 'vitest';
import { ElGamalCiphertext } from '@solana/zk-sdk';
import type { Signature } from '@solana/kit';
import {
  assertDevnet,
  attestTransfer,
  auditorKeys,
  balance,
  confidentialTransfer,
  ctState,
  fetchTransferData,
  verifyAttestation,
} from '../src/index.js';
import { escrow, log, newFundedUser, usd } from './helpers.js';

async function transferTx(sigs: Signature[]): Promise<Signature> {
  for (const s of [...sigs].reverse()) {
    try {
      await fetchTransferData(s);
      return s;
    } catch {
      /* proof / context-state tx */
    }
  }
  throw new Error('no transfer tx in plan');
}

// PRD 3.5: auditor decrypts a transfer amount, but not an account's available balance.
describe('solana.auditor (live devnet)', () => {
  beforeAll(assertDevnet);

  it('decrypts + attests a transfer amount, cannot decrypt available balance', async () => {
    const user = await newFundedUser(usd(20), usd(20));
    log('auditor fund user', user.sigs);
    const esc = await escrow();
    const sigs = await confidentialTransfer(user.keys, esc.owner.address, usd(7.25));
    const sig = await transferTx(sigs);
    log('auditor confidential transfer', [sig]);

    const a = await attestTransfer(sig);
    expect(a.statement.amount).toBe(usd(7.25).toString());
    expect(await verifyAttestation(a)).toBe(true);
    expect(await verifyAttestation({ ...a, statement: { ...a.statement, amount: '1' } })).toBe(
      false,
    );
    console.log('[evidence] auditor attestation', JSON.stringify(a));

    // Available balance is encrypted to the owner's ElGamal key only.
    const actual = (await balance(user.keys)).availableBalance;
    expect(actual).toBe(usd(12.75));
    const ct = ElGamalCiphertext.fromBytes(
      new Uint8Array((await ctState(user.keys.owner.address)).availableBalance),
    );
    if (!ct) throw new Error('malformed available-balance ciphertext');
    let auditorView: bigint | undefined;
    try {
      auditorView = auditorKeys().secret().decrypt(ct);
    } catch {
      auditorView = undefined; // discrete log not found
    }
    expect(auditorView).not.toBe(actual);
  });
});
