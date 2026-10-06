"use client";

import { useEffect, useRef, useState } from "react";

const STOPS = [
  {
    chain: "Tempo",
    slug: "tempo",
    act: "Sign in with your fingerprint",
    sees: "A new passkey account. Fees paid by the app.",
    you: "No seed phrase to write down, no gas to buy.",
  },
  {
    chain: "Zcash",
    slug: "zcash",
    act: "Send shielded ZEC. The memo is the order",
    sees: "A shielded transaction. Nothing about the bet.",
    you: "Market, side, size and your return address, sealed in the memo.",
  },
  {
    chain: "Solana",
    slug: "solana",
    act: "Your bankroll settles in a confidential balance",
    sees: "That an account exists.",
    you: "The balance and every amount moving in or out.",
  },
  {
    chain: "Hyperliquid",
    slug: "hyperliquid",
    act: "The bet executes on the deepest book",
    sees: "An order routed through Tyr's builder code.",
    you: "Your position, inside your hard loss limit.",
  },
  {
    chain: "Tempo",
    slug: "tempo",
    act: "You get paid, with a receipt",
    sees: "A stablecoin payout tagged with a memo.",
    you: "A receipt you can prove for taxes, or keep private.",
  },
];

// Hand-drawn feeling: a meandering ink line across the scene.
const PATH =
  "M 40 210 C 140 210 150 90 250 100 S 380 230 480 190 S 600 60 700 90 S 820 220 960 150";
const STOP_AT = [0.0, 0.25, 0.5, 0.75, 1.0];

export function Journey() {
  const section = useRef<HTMLElement>(null);
  const path = useRef<SVGPathElement>(null);
  const [p, setP] = useState(0);
  const [len, setLen] = useState(0);
  const [pts, setPts] = useState<{ x: number; y: number }[]>([]);

  useEffect(() => {
    const el = path.current;
    if (!el) return;
    const L = el.getTotalLength();
    setLen(L);
    setPts(STOP_AT.map((f) => el.getPointAtLength(f * L)));
  }, []);

  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = section.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        setP(Math.min(1, Math.max(0, -r.top / total)));
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Hold briefly on each stop: map scroll to a stepped-but-eased progress.
  const raw = p * (STOPS.length - 1);
  const base = Math.floor(raw);
  const frac = raw - base;
  const eased = frac < 0.35 ? 0 : frac > 0.85 ? 1 : (frac - 0.35) / 0.5;
  const travel = Math.min(1, (base + eased * eased * (3 - 2 * eased)) / (STOPS.length - 1));
  const active = Math.min(STOPS.length - 1, Math.round(travel * (STOPS.length - 1)));
  const stop = STOPS[active];

  const seal = len && path.current ? path.current.getPointAtLength(travel * len) : { x: 40, y: 210 };

  return (
    <section ref={section} id="journey" className="relative h-[420vh] bg-paper" aria-label="The journey of a bet">
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden px-4">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-olive">The journey of a bet</p>
              <h2 className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
                Four chains. <span className="font-hand text-[1.2em] text-olive">one quiet path.</span>
              </h2>
            </div>
            <p className="eyebrow text-[0.65rem] text-ink-soft tabular-nums">
              Stop {active + 1} of {STOPS.length}
            </p>
          </div>

          {/* The path */}
          <div className="relative mt-6 sm:mt-10">
            <svg viewBox="0 0 1000 280" className="h-auto w-full overflow-visible" aria-hidden>
              <defs>
                <filter id="ink">
                  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
                  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" />
                </filter>
              </defs>
              <path d={PATH} fill="none" stroke="var(--charcoal)" strokeOpacity="0.18" strokeWidth="2" strokeDasharray="2 9" strokeLinecap="round" />
              <path
                ref={path}
                d={PATH}
                fill="none"
                stroke="var(--olive)"
                strokeWidth="3"
                strokeLinecap="round"
                filter="url(#ink)"
                strokeDasharray={len || 1}
                strokeDashoffset={len ? len * (1 - travel) : 0}
              />
              {pts.map((pt, i) => {
                const reached = travel * (STOPS.length - 1) >= i - 0.02;
                return (
                  <g key={i} transform={`translate(${pt.x} ${pt.y})`}>
                    <circle
                      r={i === active ? 30 : 24}
                      fill={reached ? "var(--sage)" : "var(--cream)"}
                      stroke="var(--charcoal)"
                      strokeWidth="1.5"
                      style={{ transition: "r .5s cubic-bezier(.2,.7,.2,1), fill .5s" }}
                    />
                    <foreignObject x="-14" y="-14" width="28" height="28">
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          background: reached ? "var(--charcoal)" : "#2b2b2b66",
                          mask: `url(/chains/${STOPS[i].slug}.svg) center / contain no-repeat`,
                          WebkitMask: `url(/chains/${STOPS[i].slug}.svg) center / contain no-repeat`,
                          transition: "background .5s",
                        }}
                      />
                    </foreignObject>
                    <text
                      y={i % 2 ? -46 : 56}
                      textAnchor="middle"
                      className="font-serif"
                      fontSize="17"
                      fill="var(--charcoal)"
                      opacity={reached ? 1 : 0.45}
                      style={{ transition: "opacity .5s" }}
                    >
                      {STOPS[i].chain}
                    </text>
                  </g>
                );
              })}
              {/* Wax seal: the bet itself */}
              <g transform={`translate(${seal.x + 20} ${seal.y - 20})`}>
                <circle r="13" fill="var(--butter)" stroke="var(--charcoal)" strokeWidth="1.5" />
                <path d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2 Z" fill="var(--charcoal)" />
              </g>
            </svg>
          </div>

          {/* What's seen at this stop */}
          <div key={active} className="journey-panel mt-6 grid gap-4 sm:mt-10 md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <div className="font-serif text-sm text-moss">On {stop.chain}</div>
              <h3 className="mt-1 font-serif text-2xl leading-snug sm:text-3xl">{stop.act}.</h3>
            </div>
            <div className="rounded-2xl border border-rule bg-cream p-5">
              <div className="eyebrow flex items-center gap-2 text-[0.62rem] text-ink-soft">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                What the chain sees
              </div>
              <p className="mt-2 leading-relaxed">{stop.sees}</p>
            </div>
            <div className="rounded-2xl border border-charcoal/70 bg-butter/60 p-5">
              <div className="eyebrow flex items-center gap-2 text-[0.62rem] text-charcoal/80">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
                </svg>
                What only you see
              </div>
              <p className="mt-2 leading-relaxed">{stop.you}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Hero headline: words rise in, then the handwritten line is inked left to right. */
export function HeroTitle() {
  const words = ["Bet", "on", "anything,"];
  return (
    <h1 className="mx-auto max-w-4xl font-serif text-[2.9rem] leading-[1.02] font-medium tracking-[-0.02em] sm:text-7xl lg:text-[5.6rem]">
      <span className="sr-only">Bet on anything, from any chain.</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <span key={w} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
            <span className="rise inline-block" style={{ animationDelay: `${120 + i * 110}ms` }}>
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          </span>
        ))}
        <br />
        <span className="ink-write inline-block font-hand text-[1.25em] leading-[0.9] font-normal tracking-normal text-olive">
          from any chain.
        </span>
      </span>
    </h1>
  );
}
