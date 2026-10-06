// PRD Phase 8 — the reference agent (examples/agent.ts) trades through the Agent API on live
// testnets: paid market data → MPP-paid stake on Tempo (capped by its access key) → Flow A
// pipeline (CT escrow on devnet, Position PDA, HL testnet order) → paid evidence. Replaying the
// bet's idempotency key returns the same order without charging again.
import { createExecutor } from '@tyr/hyperliquid';
import { confidentialAccount } from '@tyr/pipeline';
import { applyPending, ataOf, deposit, fetchPosition, mintPublic, orderId32 } from '@tyr/solana';
import { explorerTx, paymentTransfers, usd } from '@tyr/tempo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fund } from '../../../packages/tempo/test/helpers.js';
import { runAgent } from '../../../examples/agent.js';
import { agentCall, db, ownerWithAgent, startApi } from './agentHelpers.js';

const exec = createExecutor();
let base = '';
let close: () => Promise<void>;
beforeAll(async () => ({ base, close } = await startApi(exec)));
afterAll(async () => {
  await close();
  await db.$disconnect();
});

describe('reference agent (live Tempo + Solana devnet + HL testnet)', () => {
  it('places a real HL testnet bet paid via MPP within its cap', async () => {
    const STAKE = 15;
    const owner = await ownerWithAgent(base, 20);
    await fund(owner.tempoAddress, usd(25));
    const user = await db.user.findUniqueOrThrow({ where: { tempoAddress: owner.tempoAddress } });
    const keys = await confidentialAccount(db, user.id);
    await mintPublic(await ataOf(keys.owner.address), usd(30));
    await deposit(keys, usd(30));
    await applyPending(keys);

    const run = await runAgent({ baseUrl: base, privateKey: owner.agentKey, stakeUsd: STAKE });
    const bet = run.bet as Record<string, unknown> & { id: string; tempoStakeTx: `0x${string}` };
    expect(bet.step).toBe('executed');
    expect(Number(bet.filledSize)).toBeGreaterThan(0);
    expect(bet.simulated).toBe(exec.mode === 'paper');
    expect(bet.agentSessionId).toBe(owner.sessionId);

    // the stake is the agent's MPP payment: owner → treasury on Tempo, exactly the stake
    const transfers = await paymentTransfers(bet.tempoStakeTx);
    expect(
      transfers.find((t) => t.from.toLowerCase() === owner.tempoAddress.toLowerCase())?.amount,
    ).toBe(usd(STAKE));
    expect(await fetchPosition(keys.owner.address, orderId32(bet.id))).toBeTruthy();
    expect(run.evidence).toMatchObject({ order: { id: bet.id } });
    console.log(`[evidence] agent stake (MPP): ${explorerTx(bet.tempoStakeTx)}`);
    console.log(`[evidence] agent bet solana open: ${String(bet.solanaOpenTx)}`);

    // ledger: data + bet + evidence charges
    const s = await db.agentSession.findUniqueOrThrow({
      where: { id: owner.sessionId },
      include: { charges: true },
    });
    expect(s.charges.map((c) => c.kind).sort()).toEqual(['bet', 'data', 'evidence']);
    expect(Number(s.spentUsd)).toBeCloseTo(STAKE + 0.02, 6);

    // idempotent replay: same order, no second charge
    const replay = await agentCall(base, owner.agentKey, 'POST', '/api/agent/bets', {
      outcome: run.outcome,
      side: 'yes',
      stakeUsd: STAKE,
      idempotencyKey: (await db.order.findUniqueOrThrow({ where: { id: bet.id } })).idempotencyKey,
    });
    expect(replay.status).toBe(200);
    expect(replay.json.id).toBe(bet.id);
    expect(await db.agentCharge.count({ where: { sessionId: owner.sessionId } })).toBe(3);

    // a second $15 stake would exceed the $20 cap: preflight passes, the chain refuses the
    // payment, so no order is created.
    await expect(
      runAgent({ baseUrl: base, privateKey: owner.agentKey, stakeUsd: STAKE, log: () => {} }),
    ).rejects.toThrow(/SpendingLimitExceeded|402/);
    expect(await db.order.count({ where: { agentSessionId: owner.sessionId } })).toBe(1);
  });
});
