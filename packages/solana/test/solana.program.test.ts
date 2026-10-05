import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import {
  anchorErrorCode,
  assertDevnet,
  commitAmount,
  explorer,
  fetchConfig,
  fetchMarket,
  fetchPosition,
  openPositionIx,
  orderId32,
  pauseIx,
  registerMarketIx,
  sendAtomic,
  settlePositionIx,
  signerFromFile,
  treasury,
  TyrError,
  amountCommitment,
} from '../src/index.js';

const ev = (label: string, sig: string) => console.log(`[evidence] ${label}: ${explorer(sig)}`);

async function expectAnchorError(p: Promise<unknown>, code: number) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'tx should have failed').not.toBeNull();
  expect(anchorErrorCode(err)).toBe(code);
}

// PRD 3.4 program suite against the deployed devnet program.
describe('tyr_settlement program (live devnet)', () => {
  let admin: Awaited<ReturnType<typeof signerFromFile>>;
  let relayer: Awaited<ReturnType<typeof treasury>>;
  const marketId = BigInt(randomBytes(6).readUIntLE(0, 6));
  const user = '6pw4KRHDHgXZthjrCEu3XNPMizwWzKsDGcKxvWsYyzC3' as never;

  beforeAll(async () => {
    await assertDevnet();
    admin = await signerFromFile(
      process.env.SOLANA_DEPLOYER_KEYPAIR ?? 'keys/solana-deployer.json',
    );
    relayer = await treasury();
    const c = await fetchConfig();
    expect(c?.admin).toBe(admin.address);
    expect(c?.relayer).toBe(relayer.address);
    ev('register market', await sendAtomic([await registerMarketIx(admin, marketId)], admin));
  });

  afterAll(async () => {
    if ((await fetchConfig())?.paused) await sendAtomic([await pauseIx(admin, false)], admin);
  });

  it('opens and settles a position with only commitments on-chain', async () => {
    const orderId = orderId32(`test-${Date.now()}`);
    const stake = commitAmount(2_000_000n);
    ev(
      'open_position',
      await sendAtomic(
        [
          await openPositionIx({
            relayer,
            user,
            marketId,
            orderId,
            side: 0,
            sizeCommitment: stake.commitment,
          }),
        ],
        relayer,
      ),
    );
    let p = await fetchPosition(user, orderId);
    expect(p?.status).toBe('open');
    expect(p?.sizeCommitment).toEqual(amountCommitment(2_000_000n, Buffer.from(stake.salt, 'hex')));
    expect((await fetchMarket(marketId))?.openPositions).toBe(1n);

    const payout = commitAmount(3_700_000n);
    ev(
      'settle_position',
      await sendAtomic(
        [
          await settlePositionIx({
            relayer,
            user,
            marketId,
            orderId,
            outcome: 1,
            payoutCommitment: payout.commitment,
          }),
        ],
        relayer,
      ),
    );
    p = await fetchPosition(user, orderId);
    expect(p?.status).toBe('settled');
    expect(p?.outcome).toBe(1);
    expect(p?.payoutCommitment).toEqual(payout.commitment);
    expect((await fetchMarket(marketId))?.openPositions).toBe(0n);

    // double settle rejected
    await expectAnchorError(
      sendAtomic(
        [
          await settlePositionIx({
            relayer,
            user,
            marketId,
            orderId,
            outcome: 0,
            payoutCommitment: payout.commitment,
          }),
        ],
        relayer,
      ),
      TyrError.AlreadySettled,
    );
  });

  it('rejects settle from a non-relayer signer', async () => {
    const orderId = orderId32(`test-unauth-${Date.now()}`);
    await sendAtomic(
      [
        await openPositionIx({
          relayer,
          user,
          marketId,
          orderId,
          side: 1,
          sizeCommitment: commitAmount(1n).commitment,
        }),
      ],
      relayer,
    );
    const mallory = await generateKeyPairSigner();
    const ix = await settlePositionIx({
      relayer: mallory,
      user,
      marketId,
      orderId,
      outcome: 0,
      payoutCommitment: new Uint8Array(32),
    });
    // treasury pays the fee; mallory signs as "relayer" → has_one check fails
    await expectAnchorError(sendAtomic([ix], relayer), TyrError.Unauthorized);
    expect((await fetchPosition(user, orderId))?.status).toBe('open');
  });

  it('pause blocks open_position; non-admin cannot pause', async () => {
    const mallory = await generateKeyPairSigner();
    await expectAnchorError(
      sendAtomic([await pauseIx(mallory, true)], relayer),
      TyrError.Unauthorized,
    );

    ev('pause', await sendAtomic([await pauseIx(admin, true)], admin));
    const orderId = orderId32(`test-paused-${Date.now()}`);
    await expectAnchorError(
      sendAtomic(
        [
          await openPositionIx({
            relayer,
            user,
            marketId,
            orderId,
            side: 0,
            sizeCommitment: commitAmount(1n).commitment,
          }),
        ],
        relayer,
      ),
      TyrError.Paused,
    );
    expect(await fetchPosition(user, orderId)).toBeNull();
    ev('unpause', await sendAtomic([await pauseIx(admin, false)], admin));
  });
});
