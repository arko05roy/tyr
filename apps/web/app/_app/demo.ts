// Demo book for the dashboard (:3001). When the API comes back empty, these fill the page so
// the post-demo walkthrough looks like a lived-in account. Real data always wins when present.
import type { Order } from "@tyr/api-client";
import { isDashboard } from "./surface";

export const DEMO = isDashboard;

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function order(o: Partial<Order> & Pick<Order, "id" | "marketId" | "side" | "stakeUsd" | "avgPx" | "createdAt">): Order {
  const stake = Number(o.stakeUsd);
  const px = Number(o.avgPx);
  return {
    userId: "demo",
    agentSessionId: null,
    idempotencyKey: null,
    hlMarket: null,
    routeKey: null,
    isBuy: true,
    tif: "Ioc",
    size: (stake / px).toFixed(2),
    price: String(px),
    filledSize: (stake / px).toFixed(2),
    stakeSalt: null,
    builderFee: null,
    hlOid: null,
    simulated: false,
    status: "filled",
    step: "opened",
    error: null,
    tempoStakeTx: null,
    escrowTx: null,
    solanaOpenTx: null,
    parentId: null,
    updatedAt: o.createdAt,
    settlement: null,
    ...o,
  };
}

function settled(o: Order, won: boolean, hoursAgo: number): Order {
  const stake = Number(o.stakeUsd);
  const payout = won ? Number(o.filledSize) : 0;
  return {
    ...o,
    status: "settled",
    step: "settled",
    settlement: {
      orderId: o.id,
      outcome: won ? "won" : "lost",
      pnl: (payout - stake).toFixed(2),
      payoutUsd: payout.toFixed(2),
      payoutSalt: null,
      solanaTx: null,
      escrowPayTx: null,
      escrowTopUpTx: null,
      tempoPayoutTx: null,
      memoHash: null,
      closeOrderId: null,
      createdAt: ago(hoursAgo),
    },
  };
}

export const demoBets: Order[] = [
  order({ id: "demo-1", marketId: "hyperliquid:btc-120k-oct", hlMarket: "BTC above $120k on Oct 31", side: "yes", stakeUsd: "25.00", avgPx: "0.62", createdAt: ago(3) }),
  order({ id: "demo-2", marketId: "polymarket:fed-cut-nov", hlMarket: "Fed cuts rates in November", side: "yes", stakeUsd: "40.00", avgPx: "0.71", createdAt: ago(9) }),
  order({ id: "demo-3", marketId: "kalshi:eth-5k-q4", hlMarket: "ETH above $5,000 by Dec 31", side: "no", stakeUsd: "18.00", avgPx: "0.55", createdAt: ago(20) }),
  order({ id: "demo-4", marketId: "limitless:sol-etf-2026", hlMarket: "Spot SOL ETF approved in 2026", side: "yes", stakeUsd: "12.00", avgPx: "0.38", createdAt: ago(28) }),
  settled(order({ id: "demo-5", marketId: "hyperliquid:btc-110k-sep", hlMarket: "BTC above $110k on Sep 30", side: "yes", stakeUsd: "30.00", avgPx: "0.58", createdAt: ago(260) }), true, 220),
  settled(order({ id: "demo-6", marketId: "polymarket:cpi-sep", hlMarket: "September CPI above 3.0%", side: "no", stakeUsd: "20.00", avgPx: "0.64", createdAt: ago(300) }), true, 240),
  settled(order({ id: "demo-7", marketId: "kalshi:nfp-sep", hlMarket: "Payrolls beat 150k in September", side: "yes", stakeUsd: "15.00", avgPx: "0.47", createdAt: ago(340) }), false, 290),
];

export const demoBalanceUsd = 1_284.52;

export const demoDeposits = [
  { id: "dd-1", createdAt: ago(30), amount: "500", asset: "USDC", sourceChain: "solana", status: "credited" },
  { id: "dd-2", createdAt: ago(120), amount: "0.25", asset: "ETH", sourceChain: "base", status: "credited" },
  { id: "dd-3", createdAt: ago(400), amount: "250", asset: "AlphaUSD", sourceChain: "tempo", status: "credited" },
];

export const demoReceipts = [
  { id: "demo-r1", kind: "bet", subjectId: "demo-5", payloadHash: "0x7c1f9a3e5b20d4c86e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7", visibility: "public" as const, createdAt: ago(220) },
  { id: "demo-r2", kind: "bet", subjectId: "demo-6", payloadHash: "0x2e8d4b6a1c3f5e7092a4b6c8d0e2f41638a5c7e9b1d3f50728496a3c5e7f9b1d", visibility: "private" as const, createdAt: ago(240) },
  { id: "demo-r3", kind: "zcash-payout", subjectId: null, payloadHash: "0x9b3d5f7a1c2e4068a0c2e4f6a8b0d2f4163850a2c4e6f8b0d2f416385a7c9e1b", visibility: "private" as const, createdAt: ago(150) },
];

export const demoSessions = [
  { id: "demo-s1", name: "edge-hunter", agentAddress: "0x4f2A9c1E7b3D5e8F0a6C2b9D1e3F5a7C9b0D2e4F", capUsd: 50, spentUsd: 31.4, period: "day", expiresAt: ago(-720), revokedAt: null, authorizedTx: null, active: true, remainingUsd: 18.6 },
  { id: "demo-s2", name: "macro-bot", agentAddress: "0x8c3B1d5F7a9E2c4D6b8A0f1E3d5C7b9A2e4D6f8B", capUsd: 100, spentUsd: 42.75, period: "week", expiresAt: ago(-720), revokedAt: null, authorizedTx: null, active: true, remainingUsd: 57.25 },
  { id: "demo-s3", name: "news-scraper", agentAddress: "0x1a7E3c9B5d2F4a6C8e0B2d4F6a8C0e2B4d6F8a0C", capUsd: 20, spentUsd: 20, period: "day", expiresAt: ago(48), revokedAt: ago(50), authorizedTx: null, active: false, remainingUsd: 0 },
];

export const demoAgentCalls = [
  { at: ago(0.2), agent: "edge-hunter", route: "GET /markets/42/data", usd: 0.01 },
  { at: ago(0.3), agent: "edge-hunter", route: "POST /bets", usd: 12 },
  { at: ago(1.1), agent: "macro-bot", route: "GET /evidence/demo-2", usd: 0.01 },
  { at: ago(1.4), agent: "macro-bot", route: "GET /markets/17/data", usd: 0.01 },
  { at: ago(2.6), agent: "edge-hunter", route: "POST /bets", usd: 18 },
  { at: ago(5), agent: "macro-bot", route: "POST /bets", usd: 25 },
];

export const demoZcashOrders = [
  { txid: "a3f1c9e27b5d4086", market: "BTC above $120k on Oct 31", side: "yes", usd: 15, zec: "0.278341", status: "placed", signers: "" },
  { txid: "5e8b2d4f61a3c907", market: "ETH above $5,000 by Dec 31", side: "no", usd: 25, zec: "0.463902", status: "paid", signers: "1,3" },
  { txid: "c71e9a3b5d2f8046", market: "BTC above $110k on Sep 30", side: "yes", usd: 40, zec: "0.742284", status: "paid", signers: "2,3" },
];

/** Real list if it has anything, else the demo list on the dashboard. */
export const orDemo = <T,>(real: T[] | undefined, demo: T[]): T[] => (real?.length ? real : DEMO ? demo : (real ?? []));
