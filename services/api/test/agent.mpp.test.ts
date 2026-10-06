// PRD Phase 8 — MPP-paid agent endpoints on live Moderato.
// Cap $0.025 at $0.01/call: unsigned → 401; signed → 402 challenge; pay → 200 (twice);
// third payment exceeds the access-key limit → rejected on-chain → still 402.
import { featuredMarkets } from '@tyr/hyperliquid';
import { explorerTx, signAgentRequest, usd } from '@tyr/tempo';
import { Mppx, tempo } from 'mppx/client';
import { privateKeyToAccount } from 'viem/accounts';
import { Account } from 'viem/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fund } from '../../../packages/tempo/test/helpers.js';
import { agentCall, db, ownerWithAgent, startApi } from './agentHelpers.js';

let base = '';
let close: () => Promise<void>;
beforeAll(async () => ({ base, close } = await startApi()));
afterAll(async () => {
  await close();
  await db.$disconnect();
});

describe('agent MPP endpoints (live Moderato)', () => {
  it('402 → pay → 200; over cap → payment reverts → still 402', async () => {
    const owner = await ownerWithAgent(base, 0.025);
    console.log(`[evidence] agent key authorized: ${explorerTx(owner.authTx)}`);
    await fund(owner.tempoAddress, usd(1));
    const [m] = await featuredMarkets();
    if (!m) throw new Error('no featured market');
    const path = `/api/agent/markets/${m.outcome}/data`;

    expect((await fetch(base + path)).status).toBe(401);
    const unpaid = await agentCall(base, owner.agentKey, 'GET', path);
    expect(unpaid.status).toBe(402);
    expect(unpaid.headers.get('www-authenticate')).toMatch(/^Payment .*method="tempo"/);

    const me = await agentCall(base, owner.agentKey, 'GET', '/api/agent/me');
    expect(me.json).toMatchObject({ capUsd: 0.025, remainingUsd: 0.025, active: true });

    const payer = Mppx.create({
      methods: [
        tempo({ account: Account.fromSecp256k1(owner.agentKey, { access: owner.tempoAddress }) }),
      ],
      polyfill: false,
    });
    const paidCall = async () =>
      payer.fetch(base + path, {
        headers: await signAgentRequest(privateKeyToAccount(owner.agentKey), {
          method: 'GET',
          path,
        }),
      });

    for (let i = 0; i < 2; i++) {
      const res = await paidCall();
      expect(res.status).toBe(200);
      expect(res.headers.get('payment-receipt')).toBeTruthy();
      const body = (await res.json()) as { paymentTx: `0x${string}`; books: unknown };
      expect(body.books).toBeTruthy();
      console.log(`[evidence] agent data payment ${i + 1}: ${explorerTx(body.paymentTx)}`);
    }

    const over = await paidCall().then(
      (r) => `status ${r.status}`,
      (e: Error) => e.message,
    );
    console.log('over cap →', over.split('\n')[0]);
    expect(over).toMatch(/SpendingLimitExceeded|status 402/);
    expect((await agentCall(base, owner.agentKey, 'GET', path)).status).toBe(402);

    const s = await db.agentSession.findUniqueOrThrow({
      where: { id: owner.sessionId },
      include: { charges: true },
    });
    expect(Number(s.spentUsd)).toBeCloseTo(0.02, 6);
    expect(s.charges).toHaveLength(2);
    const list = await owner.api('GET', '/api/agent/sessions');
    expect(list.json.sessions[0]).toMatchObject({ spentUsd: 0.02, remainingUsd: 0.005 });

    // revoked sessions are refused before any payment
    expect((await owner.api('DELETE', `/api/agent/sessions/${owner.sessionId}`)).status).toBe(200);
    expect((await agentCall(base, owner.agentKey, 'GET', path)).status).toBe(403);
  });
});
