import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyPending,
  assertDevnet,
  balance,
  confidentialTransfer,
  ctState,
  solana,
  withdraw,
} from '../src/index.js';
import { escrow, log, newFundedUser, usd } from './helpers.js';

// PRD Phase 3 test: deposit → apply → confidential transfer → withdraw on live devnet.
describe('solana.ct (live devnet)', () => {
  beforeAll(assertDevnet);

  it('round-trips a confidential bankroll with no plaintext amounts on-chain', async () => {
    const user = await newFundedUser(usd(100), usd(50));
    log('ct create+mint+deposit+apply', user.sigs);

    let b = await balance(user.keys);
    expect(b.publicAmount).toBe(usd(50));
    expect(b.availableBalance).toBe(usd(50));
    expect(b.pendingBalance).toBe(0n);

    const esc = await escrow();
    const before = (await balance(esc)).availableBalance;
    const tsigs = await confidentialTransfer(user.keys, esc.owner.address, usd(12.5));
    log('ct confidential transfer user→escrow', tsigs);
    log('ct escrow apply', [await applyPending(esc)]);
    expect((await balance(esc)).availableBalance - before).toBe(usd(12.5));

    const wsigs = await withdraw(user.keys, usd(2.5));
    log('ct withdraw', wsigs);

    b = await balance(user.keys);
    expect(b.availableBalance).toBe(usd(35)); // 50 − 12.5 − 2.5, decrypted with owner AE key
    expect(b.publicAmount).toBe(usd(52.5));

    // On-chain balance fields are ciphertext only: 64-byte ElGamal / 36-byte AE blobs,
    // and the plaintext u64 of the confidential balance appears nowhere in the account.
    const ext = await ctState(user.keys.owner.address);
    expect(ext.availableBalance.length).toBe(64);
    expect(ext.decryptableAvailableBalance.length).toBe(36);
    expect(ext.availableBalance.some((x) => x !== 0)).toBe(true);
    const info = await solana()
      .rpc.getAccountInfo(user.token, { encoding: 'base64', commitment: 'confirmed' })
      .send();
    if (!info.value) throw new Error('token account missing');
    const raw = Buffer.from(info.value.data[0], 'base64');
    const plain = Buffer.alloc(8);
    plain.writeBigUInt64LE(usd(35));
    expect(raw.indexOf(plain)).toBe(-1);
  });
});
