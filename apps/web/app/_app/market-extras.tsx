"use client";
// Demo-only market detail extras (dashboard :3001): price history, depth, recent fills and
// resolution info, generated deterministically from the event key so a refresh looks the same.
import { useMemo, useState } from "react";
import { cents, usd } from "./api";

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const RANGES = { "1D": 24, "1W": 7 * 24, "1M": 30 * 24, ALL: 90 * 24 } as const;
type Range = keyof typeof RANGES;

/** Random walk that ends exactly at `last`. */
function history(seed: string, last: number, hours: number, n = 80) {
  const r = rng(`${seed}:${hours}`);
  const pts = [last];
  for (let i = 1; i < n; i++) {
    const next = pts[i - 1]! + (r() - 0.5) * 0.045 * Math.sqrt(hours / 24 / 4 + 0.3);
    pts.push(Math.min(0.97, Math.max(0.03, next)));
  }
  return pts.reverse();
}

export function PriceChart({ seed, yes }: { seed: string; yes: number }) {
  const [range, setRange] = useState<Range>("1W");
  const pts = useMemo(() => history(seed, yes, RANGES[range]), [seed, yes, range]);
  const [hover, setHover] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const W = 640, H = 200, P = 8;
  const lo = Math.min(...pts) - 0.03, hi = Math.max(...pts) + 0.03;
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const change = yes - pts[0]!;
  const shown = hover === null ? yes : pts[hover]!;
  const hoursBack = hover === null ? 0 : ((pts.length - 1 - hover) / (pts.length - 1)) * RANGES[range];

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow !text-[0.65rem] text-ink-soft">Yes · best price across venues</p>
          <p className="num mt-1 font-serif text-4xl">
            {(shown * 100).toFixed(1)}% <span className="text-base text-ink-soft">chance</span>
          </p>
          <p className={`num text-sm ${change >= 0 ? "text-olive" : "text-[#9a4a3a]"}`}>
            {hover === null
              ? `${change >= 0 ? "▲" : "▼"} ${(Math.abs(change) * 100).toFixed(1)} pts · ${range}`
              : new Date(now - hoursBack * 3_600_000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex gap-1">
          {(Object.keys(RANGES) as Range[]).map((k) => (
            <button key={k} type="button" onClick={() => setRange(k)} className={`chip !px-2.5 !py-1 text-xs ${range === k ? "bg-charcoal text-cream" : "border border-rule"}`}>
              {k}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-4 h-48 w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - b.left) / b.width) * (pts.length - 1)));
        }}
      >
        <defs>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--olive)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--olive)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} stroke="var(--rule)" strokeDasharray="3 5" />
        ))}
        <path d={`${line}L${x(pts.length - 1)},${H}L${x(0)},${H}Z`} fill="url(#fill)" />
        <path d={line} fill="none" stroke="var(--olive)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--charcoal)" strokeOpacity="0.3" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(pts[hover]!)} r="4" fill="var(--olive)" />
          </>
        )}
      </svg>
    </div>
  );
}

export function MarketStats({ seed, liquidity, venues }: { seed: string; liquidity: number; venues: number }) {
  const r = rng(`${seed}:stats`);
  const vol = Math.round(liquidity * (0.6 + r() * 1.8));
  const traders = Math.round(180 + r() * 2400);
  const items = [
    ["24h volume", usd(vol, 0)],
    ["Liquidity", usd(liquidity, 0)],
    ["Traders", traders.toLocaleString()],
    ["Venues", String(venues)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="panel px-4 py-3">
          <p className="eyebrow !text-[0.6rem] text-ink-soft">{k}</p>
          <p className="num mt-0.5 font-serif text-xl">{v}</p>
        </div>
      ))}
    </div>
  );
}

export function OrderBook({ seed, ask, bid, venue }: { seed: string; ask: number; bid: number; venue: string }) {
  const r = rng(`${seed}:book`);
  const lvl = (start: number, dir: 1 | -1) =>
    Array.from({ length: 5 }, (_, i) => ({ px: start + dir * i * 0.006, size: Math.round(300 + r() * 4200) }));
  const asks = lvl(ask, 1).reverse();
  const bids = lvl(bid, -1);
  const max = Math.max(...asks.map((l) => l.size), ...bids.map((l) => l.size));
  const Row = ({ px, size, side }: { px: number; size: number; side: "ask" | "bid" }) => (
    <div className="relative flex justify-between px-4 py-1 text-sm">
      <div className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-[var(--alert)]" : "bg-sage"}`} style={{ width: `${(size / max) * 100}%` }} />
      <span className={`num relative ${side === "ask" ? "text-[#9a4a3a]" : "text-olive"}`}>{cents(px)}</span>
      <span className="num relative">{size.toLocaleString()}</span>
    </div>
  );
  return (
    <div className="panel overflow-hidden">
      <div className="flex justify-between px-4 py-3 text-xs text-ink-soft">
        <span>Yes book · {venue}</span>
        <span>Contracts</span>
      </div>
      {asks.map((l, i) => <Row key={`a${i}`} {...l} side="ask" />)}
      <p className="num border-y border-rule px-4 py-1.5 text-center text-xs text-ink-soft">spread {cents(ask - bid)}</p>
      {bids.map((l, i) => <Row key={`b${i}`} {...l} side="bid" />)}
    </div>
  );
}

export function RecentFills({ seed, yes, venues }: { seed: string; yes: number; venues: string[] }) {
  const r = rng(`${seed}:fills`);
  const fills = Array.from({ length: 7 }, (_, i) => ({
    side: r() > 0.42 ? "yes" : "no",
    px: Math.min(0.97, Math.max(0.03, yes + (r() - 0.5) * 0.03)),
    usd: Math.round(5 + r() * 240),
    venue: venues[Math.floor(r() * venues.length)]!,
    mins: Math.round(i * 4 + r() * 6 + 1),
  }));
  return (
    <div className="panel overflow-hidden">
      <p className="px-4 py-3 text-xs text-ink-soft">Recent fills</p>
      <ul className="divide-y divide-rule text-sm">
        {fills.map((f, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className={`w-8 font-medium uppercase ${f.side === "yes" ? "text-olive" : "text-[#9a4a3a]"}`}>{f.side}</span>
            <span className="num">{usd(f.usd, 0)}</span>
            <span className="num text-ink-soft">{cents(f.side === "yes" ? f.px : 1 - f.px)}</span>
            <span className="hidden truncate text-ink-soft sm:inline">{f.venue}</span>
            <span className="num text-ink-soft">{f.mins}m</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Resolution({ category, resolvesAt }: { category: string; resolvesAt: string }) {
  const source: Record<string, string> = {
    crypto: "Chainlink price feed, read at the resolution time",
    finance: "Official index close, via Chainlink",
    macro: "The official government release (BLS, FOMC statement)",
    politics: "Official results as certified",
    sports: "Official league result",
    culture: "Public announcement by the organizer",
  };
  return (
    <div className="panel p-5 text-sm">
      <p className="font-serif text-lg">How this resolves</p>
      <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2">
        <dt className="text-ink-soft">Source</dt>
        <dd>{source[category] ?? "The venue's published resolution source"}</dd>
        <dt className="text-ink-soft">Resolves</dt>
        <dd>{new Date(resolvesAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd>
        <dt className="text-ink-soft">Payout</dt>
        <dd>$1 per winning contract, to your hidden balance, with a receipt on Tempo</dd>
      </dl>
    </div>
  );
}
