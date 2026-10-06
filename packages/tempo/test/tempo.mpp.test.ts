// Live Moderato: MPP 402 charges paid by an agent access key whose on-chain spend limit is the cap.
// $0.05 cap, $0.02 per call: two calls pay → 200; the third reverts on-chain → still 402.
import { afterAll, describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { Account } from 'viem/tempo';
import { Mppx as MppxClient, tempo } from 'mppx/client';
import { authorizeAccessKey, createMpp, relyingParty, remainingLimit, usd } from '../src/index.js';
import { balanceOf, db, fund, registerUser, serve } from './helpers.js';

describe('MPP 402 on Moderato (agent access key cap)', () => {
  afterAll(() => db.$disconnect());

  it('402 → pay → 200; over cap → payment reverts → 402', async () => {
    const rp = relyingParty();
    const { auth, user } = await registerUser();
    const owner = Account.fromHeadlessWebAuthn(auth.privateKey, {
      rpId: rp.rpId,
      origin: rp.origin,
    });
    await fund(user.tempoAddress as Address, usd(1));

    const agentKey = generatePrivateKey();
    await authorizeAccessKey({
      user: owner,
      accessKeyAddress: privateKeyToAddress(agentKey),
      keyType: 'secp256k1',
      limitUsd: usd(0.05),
      period: 'day',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const mpp = createMpp();
    const { url, server } = await serve(async (req) => {
      const r = await mpp.charge({ amount: '0.02', description: 'test data' })(req);
      if (r.status === 402) return r.challenge;
      return r.withReceipt(Response.json({ data: 'paid' }));
    });

    const plain = await fetch(url);
    expect(plain.status).toBe(402);
    console.log('challenge', plain.headers.get('www-authenticate')?.slice(0, 200));

    const agent = MppxClient.create({
      methods: [
        tempo({
          account: Account.fromSecp256k1(agentKey, { access: user.tempoAddress as Address }),
        }),
      ],
      polyfill: false,
    });
    const before = await balanceOf(user.tempoAddress as Address);
    for (let i = 0; i < 2; i++) {
      const res = await agent.fetch(url);
      console.log('paid', res.status, res.headers.get('payment-receipt')?.slice(0, 200));
      expect(res.status).toBe(200);
    }
    // fees are sponsored by tyr: the owner pays exactly the two charges
    expect(before - (await balanceOf(user.tempoAddress as Address))).toBe(usd(0.04));
    const { remaining } = await remainingLimit(
      user.tempoAddress as Address,
      privateKeyToAddress(agentKey),
    );
    expect(remaining).toBe(usd(0.01));

    // over cap: the account keychain rejects the transfer, no credential is ever produced
    const over = await agent.fetch(url).then(
      (r) => `status ${r.status}`,
      (e: Error) => e.message,
    );
    console.log('over cap', over.split('\n')[0]);
    expect(over).toMatch(/SpendingLimitExceeded|status 402/);
    expect((await fetch(url)).status).toBe(402);
    server.close();
  });
});
