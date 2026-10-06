// Server-side legs of the Phase 12 Playwright run (apps/web/e2e), invoked as a CLI:
//   fund <tempoAddress> <usd>  — AlphaUSD for stake authorizations + confidential tyrUSD bankroll
//                                (treasury mint stands in for a Phase 6 deposit, as in e2e.flowA)
//   settle <orderId>           — real close at mark → settle_position → CT + Tempo memo payout
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: new URL('../../../.env', import.meta.url) });

const { PrismaClient } = await import('@tyr/db');
const { createExecutor } = await import('@tyr/hyperliquid');
const { confidentialAccount, settleOrder } = await import('@tyr/pipeline');
const { applyPending, ataOf, deposit, mintPublic } = await import('@tyr/solana');
const { usd } = await import('@tyr/tempo');
const { fund } = await import('../../../packages/tempo/test/helpers.js');

const db = new PrismaClient();
const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'fund' && a && b) {
    const user = await db.user.findUniqueOrThrow({ where: { tempoAddress: a } });
    await fund(a as `0x${string}`, usd(Number(b)));
    const keys = await confidentialAccount(db, user.id);
    await mintPublic(await ataOf(keys.owner.address), usd(Number(b)));
    await deposit(keys, usd(Number(b)));
    await applyPending(keys);
    console.log(JSON.stringify({ funded: Number(b) }));
  } else if (cmd === 'settle' && a) {
    const s = await settleOrder(db, createExecutor(), a, { kind: 'close' });
    if (!s) throw new Error('close-at-mark did not fully unwind');
    console.log(JSON.stringify({ outcome: s.outcome, tempoPayoutTx: s.tempoPayoutTx }));
  } else throw new Error('usage: webE2e.ts fund <tempoAddress> <usd> | settle <orderId>');
} finally {
  await db.$disconnect();
}
process.exit(0);
