// Live Moderato: passkey registration/login + sponsored batched tx through tyr's HTTP relay.
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, getAddress, http, publicActions, walletActions, type Address } from 'viem';
import { Account, withRelay } from 'viem/tempo';
import {
  ALPHA_USD,
  chain,
  createSponsorRelay,
  explorerTx,
  loginOptions,
  relyingParty,
  rpcUrl,
  transferCall,
  usd,
  verifyLogin,
} from '../src/index.js';
import { balanceOf, db, fund, registerUser, serve } from './helpers.js';

describe('tempo passkey (live Moderato)', () => {
  const closers: (() => void)[] = [];
  afterAll(async () => {
    closers.forEach((c) => c());
    await db.$disconnect();
  });

  it('registers, logs in, and sends a sponsored batch with zero user fee', async () => {
    const rp = relyingParty();
    const { auth, user } = await registerUser();

    // Server-derived address == the address the passkey actually controls on Tempo.
    const passkey = Account.fromHeadlessWebAuthn(auth.privateKey, {
      rpId: rp.rpId,
      origin: rp.origin,
    });
    expect(user.tempoAddress).toBe(passkey.address);

    // Login: real assertion verified server-side, counter advances.
    const opts = await loginOptions(db, rp);
    const after = await verifyLogin(db, auth.get(opts.challenge) as never, rp);
    expect(after.passkeyCounter).toBeGreaterThan(user.passkeyCounter);

    // tyr's sponsor relay over HTTP; only registered users are sponsored.
    const relay = createSponsorRelay({
      isAllowed: async (sender) =>
        !!(await db.user.findUnique({ where: { tempoAddress: getAddress(sender) } })),
    });
    const { url, server } = await serve(relay.fetch);
    closers.push(() => server.close());

    console.log('fund', explorerTx(await fund(user.tempoAddress as Address, usd(3))));
    const before = await balanceOf(passkey.address);

    const client = createClient({
      account: passkey,
      chain,
      transport: withRelay(http(rpcUrl()), http(url)),
    })
      .extend(publicActions)
      .extend(walletActions);
    const sink = '0x000000000000000000000000000000000000dEaD' as Address;
    const hash = await client.sendTransaction({
      calls: [transferCall(ALPHA_USD, sink, usd(0.5)), transferCall(ALPHA_USD, sink, usd(0.5))],
      feePayer: true,
    } as never);
    const receipt = await client.waitForTransactionReceipt({ hash });
    console.log('sponsored batch', explorerTx(hash));

    expect(receipt.status).toBe('success');
    expect(before - (await balanceOf(passkey.address))).toBe(usd(1)); // transfers only — fee paid by tyr
  });
});
