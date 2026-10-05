// PRD 4.5: builder fee earned. Live rewards come from HL's referral state for the builder
// address; paper fees are summed from tyr's ledger and reported separately (never merged).
import type { PrismaClient } from '@tyr/db';
import { builderCode } from './builder.js';
import { referral } from './info.js';

export async function builderRevenue(db: PrismaClient) {
  const { b, f } = builderCode();
  const [ref, paper, live] = await Promise.all([
    referral(b),
    db.order.aggregate({ where: { simulated: true }, _sum: { builderFee: true }, _count: true }),
    db.order.aggregate({ where: { simulated: false }, _sum: { builderFee: true }, _count: true }),
  ]);
  return {
    builder: b,
    feeTenthsBps: f,
    hl: { builderRewardsUsd: Number(ref.builderRewards ?? 0) },
    ledger: {
      live: { orders: live._count, feesUsd: Number(live._sum.builderFee ?? 0) },
      simulated: { orders: paper._count, feesUsd: Number(paper._sum.builderFee ?? 0) },
    },
  };
}
