// Live Moderato: $5 loss limit enforced by the chain via the backend-held access key.
import { afterAll, describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { Account } from 'viem/tempo';
import {
  LimitExceededError,
  authorizeAccessKey,
  debitStake,
  explorerTx,
  memo32,
  newAccessKey,
  relyingParty,
  remainingLimit,
  usd,
} from '../src/index.js';
import { db, fund, registerUser } from './helpers.js';

describe('tempo loss limit (live Moderato)', () => {
  afterAll(() => db.$disconnect());

  it('$5 limit: $4 stake succeeds, $2 stake is rejected on-chain', async () => {
    const rp = relyingParty();
    const { auth, user } = await registerUser();
    const passkey = Account.fromHeadlessWebAuthn(auth.privateKey, {
      rpId: rp.rpId,
      origin: rp.origin,
    });
    await fund(user.tempoAddress as Address, usd(10));

    const key = newAccessKey();
    const expiresAt = new Date(Date.now() + 86_400_000);
    const authTx = await authorizeAccessKey({
      user: passkey,
      accessKeyAddress: key.accessKeyAddress,
      limitUsd: usd(5),
      period: 'day',
      expiresAt,
    });
    console.log('authorize', explorerTx(authTx));
    await db.lossLimit.create({
      data: {
        userId: user.id,
        period: 'day',
        amountUsd: 5,
        tempoAccessKeyId: key.accessKeyAddress,
        accessKeyCipher: key.sealed,
        token: '0x20c0000000000000000000000000000000000001',
        expiresAt,
        authorizedTx: authTx,
      },
    });

    const ok = await debitStake(db, {
      userId: user.id,
      amount: usd(4),
      memo: memo32(`stake-${user.id}-1`),
    });
    console.log('stake $4', explorerTx(ok));
    const { remaining } = await remainingLimit(user.tempoAddress as Address, key.accessKeyAddress);
    expect(remaining).toBe(usd(1));

    const err = await debitStake(db, {
      userId: user.id,
      amount: usd(2),
      memo: memo32(`stake-${user.id}-2`),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LimitExceededError);
    expect(String(err.message)).toMatch(/SpendingLimitExceeded/);
  });
});
