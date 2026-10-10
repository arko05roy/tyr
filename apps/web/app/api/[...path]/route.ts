// Mock tyr API. Serves /api/* inside Next when no real API is configured (TYR_API_URL unset),
// so the Vercel deploy works standalone. State lives in memory per server instance: good enough
// for a demo, gone on cold start. Shapes follow services/api/src/schemas.ts.
import { randomBytes, randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { demoBalanceUsd, demoBets, demoReceipts, demoSessions } from "../../_app/demo";

const COOKIE = "tyr_session";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const b64url = (n: number) => randomBytes(n).toString("base64url");
const hex = (n: number) => `0x${randomBytes(n).toString("hex")}`;
const ALPHA_USD = "0x20c0000000000000000000000000000000000001";

type User = { id: string; tempoAddress: string; region: string | null; limit: Limit | null; balance: number; bets: unknown[]; sessions: unknown[] };
type Limit = { id: string; period: string; amountUsd: number; remainingUsd: number; periodEnd: number | null; authorizedTx: string | null };

const store = ((globalThis as { __tyrMock?: Map<string, User> }).__tyrMock ??= new Map());
const user = (id: string): User => {
  let u = store.get(id);
  if (!u) {
    u = { id, tempoAddress: hex(20), region: null, limit: null, balance: demoBalanceUsd, bets: [...demoBets], sessions: [...demoSessions] };
    store.set(id, u);
  }
  return u;
};

// ---------- markets ----------
const EVENTS = [
  { eventKey: "btc-120k-oct", title: "BTC above $120k on Oct 31", category: "crypto", h: -500, px: 0.62 },
  { eventKey: "fed-cut-nov", title: "Fed cuts rates in November", category: "macro", h: -900, px: 0.71 },
  { eventKey: "eth-5k-q4", title: "ETH above $5,000 by Dec 31", category: "crypto", h: -2000, px: 0.44 },
  { eventKey: "sol-etf-2026", title: "Spot SOL ETF approved in 2026", category: "finance", h: -5000, px: 0.38 },
  { eventKey: "nvda-earnings-beat", title: "NVIDIA beats Q3 earnings estimates", category: "finance", h: -1000, px: 0.81 },
];
const VENUES = ["hyperliquid", "polymarket", "kalshi", "limitless"] as const;
const venueInfo = [
  { id: "hyperliquid", name: "Hyperliquid", settlementChain: "hypercore", collateral: "USDH", mode: "simulated", revenue: "builder fee", minOrderUsd: 1 },
  { id: "polymarket", name: "Polymarket", settlementChain: "polygon", collateral: "USDC", mode: "simulated", revenue: "referral", minOrderUsd: 1 },
  { id: "kalshi", name: "Kalshi", settlementChain: "solana", collateral: "USDC", mode: "simulated", revenue: "taker fee", minOrderUsd: 1 },
  { id: "limitless", name: "Limitless", settlementChain: "base", collateral: "USDC", mode: "simulated", revenue: "referral", minOrderUsd: 1 },
];
const r2 = (n: number) => Math.round(n * 1000) / 1000;
const events = () =>
  EVENTS.map((e, i) => {
    const venues = VENUES.slice(0, 2 + (i % 3)).map((venue, j) => {
      const mid = r2(e.px + (j - 1) * 0.015);
      return { venue, marketId: `${venue}:${e.eventKey}`, yesBid: r2(mid - 0.01), yesAsk: r2(mid + 0.01), liquidityUsd: 20_000 + j * 7_500 };
    });
    const bestYes = venues.reduce((a, b) => (b.yesAsk < a.yesAsk ? b : a));
    const bestNo = venues.reduce((a, b) => (b.yesBid > a.yesBid ? b : a));
    return {
      eventKey: e.eventKey, title: e.title, category: e.category, resolvesAt: ago(e.h), venues,
      bestYesAsk: { venue: bestYes.venue, px: bestYes.yesAsk },
      bestNoAsk: { venue: bestNo.venue, px: r2(1 - bestNo.yesBid) },
      priceGap: r2(Math.max(...venues.map((v) => v.yesAsk)) - bestYes.yesAsk),
    };
  });
const hlMarkets = () =>
  EVENTS.map((e, i) => ({
    outcome: i, name: e.title, description: e.title, template: null, sides: ["Yes", "No"], resolvesAt: ago(e.h),
    yes: { coin: `#${i * 10}`, bid: r2(e.px - 0.01), ask: r2(e.px + 0.01), mid: e.px },
  }));

function route(eventKey: string, side: "yes" | "no", stakeUsd: number) {
  const ev = events().find((e) => e.eventKey === eventKey);
  if (!ev) return null;
  const legs = ev.venues.slice(0, 2).map((v, i) => {
    const px = side === "yes" ? v.yesAsk : r2(1 - v.yesBid);
    const costUsd = r2(stakeUsd * (i === 0 ? 0.6 : 0.4));
    return { venue: v.venue, marketId: v.marketId, sz: r2(costUsd / px), avgPx: px, limitPx: r2(px + 0.02), costUsd, feeUsd: r2(costUsd * 0.002) };
  });
  const contracts = r2(legs.reduce((s, l) => s + l.sz, 0));
  const singles = ev.venues.map((v) => {
    const px = side === "yes" ? v.yesAsk : r2(1 - v.yesBid);
    return { venue: v.venue, marketId: v.marketId, contracts: r2(stakeUsd / px), costUsd: stakeUsd };
  });
  return {
    eventKey, side, stakeUsd, legs, contracts, costUsd: stakeUsd, avgAllInPx: r2(stakeUsd / contracts), singles,
    edgeVsWorst: r2(contracts - Math.min(...singles.map((s) => s.contracts))),
  };
}

function order(u: User, o: { marketId: string; side: string; stakeUsd: number; px: number; title?: string; routeKey?: string }) {
  const now = new Date().toISOString();
  const size = (o.stakeUsd / o.px).toFixed(2);
  return {
    id: randomUUID(), userId: u.id, agentSessionId: null, idempotencyKey: b64url(8), marketId: o.marketId, hlMarket: o.title ?? null,
    routeKey: o.routeKey ?? null, side: o.side, isBuy: true, tif: "Ioc", size, price: String(o.px), filledSize: size, avgPx: String(o.px),
    stakeUsd: o.stakeUsd.toFixed(2), stakeSalt: null, builderFee: null, hlOid: null, simulated: true, execution: null, status: "filled",
    step: "opened", error: null, tempoStakeTx: hex(32), escrowTx: null, solanaOpenTx: null, parentId: null, createdAt: now, updatedAt: now, settlement: null,
  };
}

// ---------- handler ----------
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const err = (status: number, error: string) => json({ error }, status);

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const p = `/${parts.join("/")}`;
  const m = req.method;
  const body = m === "GET" || m === "DELETE" ? {} : await req.json().catch(() => ({}));
  const rpId = req.nextUrl.hostname;
  const sid = req.cookies.get(COOKIE)?.value;

  // ----- public -----
  if (m === "POST" && p === "/auth/passkey/register/options")
    return json({
      challenge: b64url(32), rp: { name: "tyr", id: rpId },
      user: { id: b64url(16), name: `tyr-${b64url(4)}`, displayName: "tyr account" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      timeout: 60_000, attestation: "none", excludeCredentials: [],
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
  if (m === "POST" && p === "/auth/passkey/login/options")
    return json({ challenge: b64url(32), rpId, timeout: 60_000, allowCredentials: [], userVerification: "preferred" });
  if (m === "POST" && (p === "/auth/passkey/register/verify" || p === "/auth/passkey/login/verify")) {
    // Mock: trust the credential id as the account id, no signature check.
    const id = String((body as { id?: string }).id ?? randomUUID()).slice(0, 64);
    const u = user(id);
    const res = json({ userId: u.id, tempoAddress: u.tempoAddress });
    res.cookies.set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }
  if (m === "GET" && p === "/venues") return json({ venues: venueInfo });
  if (m === "GET" && p === "/venues/events") return json({ events: events() });
  if (m === "GET" && p === "/venues/markets")
    return json({
      markets: events().flatMap((e) => e.venues.map((v) => ({
        id: v.marketId, venue: v.venue, nativeId: e.eventKey, title: e.title, category: e.category, eventKey: e.eventKey, resolvesAt: e.resolvesAt,
        yes: { bid: v.yesBid, ask: v.yesAsk, mid: r2((v.yesBid + v.yesAsk) / 2) }, liquidityUsd: v.liquidityUsd,
      }))),
      errors: [],
    });
  if (m === "POST" && p === "/venues/route") {
    const b = body as { eventKey: string; side: "yes" | "no"; stakeUsd: number };
    return json(route(b.eventKey, b.side, b.stakeUsd) ?? { error: "unknown event" }, route(b.eventKey, b.side, b.stakeUsd) ? 200 : 404);
  }
  if (m === "GET" && p === "/markets") return json({ markets: hlMarkets() });
  if (m === "POST" && p === "/zcash/request") {
    const b = body as { stakeUsd: number; outcome: number };
    const zecUsd = 53.9;
    const zat = String(Math.round((b.stakeUsd / zecUsd) * 1e8));
    const to = `utest1${b64url(40).toLowerCase().replace(/[^a-z0-9]/g, "q")}`;
    const memo = `tyr:${b.outcome}:${b64url(6)}`;
    return json({ uri: `zcash:${to}?amount=${Number(zat) / 1e8}&memo=${Buffer.from(memo).toString("base64url")}`, to, zat, memo, zecUsd });
  }
  if (m === "GET" && parts[0] === "zcash" && parts[1] === "orders" && parts[2])
    return json({
      id: randomUUID(), txid: parts[2], status: "placed", marketId: "hyperliquid:0", side: "yes", size: "25.00",
      zecUsd: "53.9", payoutZat: null, payoutTxid: null, error: null, orderId: null,
    });

  // ----- authenticated -----
  if (!sid) return err(401, "not signed in");
  const u = user(sid);

  if (m === "GET" && p === "/auth/me")
    return json({ userId: u.id, tempoAddress: u.tempoAddress, region: u.region, passkey: { credentialId: u.id, publicKey: hex(64) } });
  if (m === "PUT" && p === "/auth/region") {
    u.region = (body as { region?: string }).region ?? null;
    return json({ region: u.region, hedge: u.region === "US" ? { eligible: false, reason: "not available in your region" } : { eligible: true } });
  }

  if (m === "GET" && p === "/limits") return json({ limit: u.limit });
  if (m === "POST" && p === "/limits/prepare") {
    const b = body as { amountUsd: number; period: "day" | "week" };
    const limitId = randomUUID();
    u.limit = { id: limitId, period: b.period, amountUsd: b.amountUsd, remainingUsd: b.amountUsd, periodEnd: null, authorizedTx: null };
    return json({
      limitId, accessKey: { accessKeyAddress: hex(20), keyType: "p256" }, expiry: Math.floor(Date.now() / 1000) + 30 * 86400,
      limits: [{ token: ALPHA_USD, limit: String(Math.round(b.amountUsd * 1e6)), period: b.period === "day" ? 86400 : 604800 }],
    });
  }
  if (m === "PUT" && p === "/limits/confirm") {
    if (!u.limit) return err(404, "no pending limit");
    u.limit.authorizedTx = (body as { txHash?: string }).txHash ?? hex(32);
    u.limit.periodEnd = Math.floor(Date.now() / 1000) + (u.limit.period === "day" ? 86400 : 604800);
    return json({ limitId: u.limit.id, remainingUsd: u.limit.remainingUsd });
  }

  if (m === "GET" && p === "/balance") return json({ availableUsd: Math.round(u.balance * 100) / 100, token: "tyrUSD" });
  if (m === "GET" && p === "/bets") return json({ bets: u.bets });
  if (m === "GET" && parts[0] === "bets" && parts[1]) {
    const b = u.bets.find((x) => (x as { id: string }).id === parts[1]);
    return b ? json(b) : err(404, "not found");
  }
  if (m === "POST" && p === "/bets/routed") {
    const b = body as { eventKey: string; side: "yes" | "no"; stakeUsd: number };
    const r = route(b.eventKey, b.side, b.stakeUsd);
    if (!r) return err(404, "unknown event");
    if (b.stakeUsd > u.balance) return json({ error: "insufficient balance", code: "balance" }, 402);
    if (u.limit && b.stakeUsd > u.limit.remainingUsd) return json({ error: "over your loss limit", code: "limit" }, 402);
    const title = EVENTS.find((e) => e.eventKey === b.eventKey)?.title;
    const routeKey = randomUUID();
    const orders = r.legs.map((l) => order(u, { marketId: l.marketId, side: b.side, stakeUsd: l.costUsd, px: l.avgPx, title, routeKey }));
    u.bets.unshift(...orders);
    u.balance -= b.stakeUsd;
    if (u.limit) u.limit.remainingUsd -= b.stakeUsd;
    return json({ route: r, orders }, 201);
  }

  if (m === "GET" && p === "/deposits/addresses")
    return json({
      evm: { address: u.tempoAddress, chains: ["base", "ethereum", "arbitrum"], assets: { base: ["USDC", "ETH"], ethereum: ["USDC", "ETH"], arbitrum: ["USDC"] } },
      solana: { owner: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", usdcAta: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
      tempo: { to: hex(20), memo: hex(32), token: "AlphaUSD" },
    });
  if (m === "GET" && p === "/deposits") return json({ deposits: [] });
  if (m === "POST" && p === "/deposits/claim") {
    const b = body as { chain: string; txHash: string };
    const now = new Date().toISOString();
    u.balance += 100;
    return json({
      deposits: [{
        id: randomUUID(), userId: u.id, sourceChain: b.chain, sourceTx: b.txHash, logIndex: 0, asset: "USDC", amount: "100", rawAmount: "100000000",
        fxRate: null, fxRound: null, status: "credited", mintTx: hex(32), solanaTx: null, createdAt: now, creditedAt: now,
      }],
    }, 201);
  }

  if (m === "GET" && parts[0] === "hedge" && parts[1] === "markets")
    return json({ offered: true, stock: "NVDA", token: hex(20), rule: "YES pays if the stock closes higher", yesDirection: "sell", simulated: true });
  if (m === "GET" && parts[0] === "hedge" && parts[2] === "quote") {
    const amt = Number(req.nextUrl.searchParams.get("amountUsd") ?? 10);
    return json({
      simulated: true, orderId: parts[1], stock: "NVDA", token: hex(20), direction: "sell", rule: "YES pays if the stock closes higher",
      amountInUsd: amt, maxAmountInUsd: 100, entryPx: 182.4, shares: r2(amt / 182.4), priceSource: "chainlink (mock)", priceAt: new Date().toISOString(), feeBps: 30,
    });
  }
  if (m === "POST" && p === "/hedge") {
    const b = body as { orderId: string; amountUsd?: number };
    const amt = b.amountUsd ?? 10;
    const now = new Date().toISOString();
    return json({
      orderId: b.orderId, userId: u.id, symbol: "NVDA", stockToken: hex(20), direction: "sell", amountIn: amt.toFixed(2), amountOut: (amt / 182.4).toFixed(4),
      entryPx: "182.40", exitPx: null, valueUsd: null, priceSource: "chainlink (mock)", priceAt: now, simulated: true, status: "open", uniswapTx: null,
      chainlinkRound: null, escrowTx: null, payTx: null, escrowTopUpTx: null, receiptId: null, receiptTx: null, createdAt: now, closedAt: null,
    }, 201);
  }
  if (m === "GET" && p === "/hedge") return json({ hedges: [] });

  if (m === "GET" && p === "/agent/sessions") return json({ sessions: u.sessions });
  if (m === "POST" && p === "/agent/sessions") {
    const b = body as { agentAddress: string; capUsd: number; period?: string; name?: string; expiresInDays?: number };
    const id = randomUUID();
    const period = b.period ?? "day";
    u.sessions.unshift({
      id, name: b.name ?? null, agentAddress: b.agentAddress, capUsd: b.capUsd, spentUsd: 0, period,
      expiresAt: ago(-24 * (b.expiresInDays ?? 30)), revokedAt: null, authorizedTx: null, active: false, remainingUsd: b.capUsd,
    });
    return json({
      sessionId: id, accessKey: { accessKeyAddress: b.agentAddress, keyType: "secp256k1" }, expiry: Math.floor(Date.now() / 1000) + 86400 * (b.expiresInDays ?? 30),
      limits: [{ token: ALPHA_USD, limit: String(Math.round(b.capUsd * 1e6)), period: period === "day" ? 86400 : 604800 }],
    }, 201);
  }
  if (parts[0] === "agent" && parts[1] === "sessions" && parts[2]) {
    const s = u.sessions.find((x) => (x as { id: string }).id === parts[2]) as Record<string, unknown> | undefined;
    if (!s) return err(404, "not found");
    if (m === "PUT" && parts[3] === "confirm") {
      Object.assign(s, { active: true, authorizedTx: (body as { txHash?: string }).txHash ?? hex(32) });
      return json({ sessionId: s.id, remainingUsd: s.remainingUsd });
    }
    if (m === "DELETE") {
      Object.assign(s, { active: false, revokedAt: new Date().toISOString() });
      return json({ sessionId: s.id, revoked: true });
    }
  }

  if (m === "GET" && p === "/receipts") return json({ receipts: demoReceipts });
  if (parts[0] === "receipts" && parts[1]) {
    const r = demoReceipts.find((x) => x.id === parts[1]) ?? { ...demoReceipts[0], id: parts[1] };
    if (m === "GET" && !parts[2]) return json({ ...r, payload: { kind: r.kind, subjectId: r.subjectId, note: "mock receipt" } });
    if (m === "GET" && parts[2] === "verify")
      return json({ receiptId: r.id, kind: r.kind, ok: true, checks: [{ name: "payload hash", ok: true }, { name: "tempo memo", ok: true, detail: "mock" }] });
    if (m === "GET" && parts[2] === "proof")
      return json({
        receiptId: r.id, kind: r.kind, payloadHash: r.payloadHash, provedAt: new Date().toISOString(),
        tempo: [{ label: "stake", tx: hex(32), memo: r.payloadHash, explorer: "https://explore.testnet.tempo.xyz" }], solana: null, zcash: null,
      });
    if (m === "PUT" && parts[2] === "visibility") return json({ ...r, visibility: (body as { visibility?: string }).visibility ?? r.visibility });
  }

  return err(404, `mock API has no ${m} /api${p}`);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
