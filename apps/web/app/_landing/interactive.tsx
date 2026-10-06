"use client";

import Lenis from "lenis";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Lenis smooth scrolling, with in-page anchor links eased too. */
export function SmoothScroll() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.09, anchors: { offset: -80 } });
    let raf = requestAnimationFrame(function loop(t) {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);
  return null;
}

/** Fades children up when they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={{ ["--d" as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Moves its child slower than the page scroll. */
export function Parallax({
  children,
  speed = 0.15,
  className = "",
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (ref.current)
          ref.current.style.transform = `translate3d(0, ${window.scrollY * speed}px, 0)`;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [speed]);
  return (
    <div ref={ref} className={`will-change-transform ${className}`}>
      {children}
    </div>
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled ? "py-3" : "py-5"
      }`}
    >
      <nav
        className={`mx-auto flex max-w-6xl items-center justify-between rounded-full px-5 py-2.5 transition-all duration-500 sm:px-7 ${
          scrolled
            ? "mx-4 border border-rule bg-paper/85 shadow-[0_10px_30px_-20px_#4c6b46] backdrop-blur-md xl:mx-auto"
            : "border border-transparent"
        }`}
      >
        <a href="#top" className="font-serif text-3xl font-semibold tracking-tight">
          TYR
        </a>
        <div className="hidden items-center gap-8 font-serif text-[0.95rem] md:flex">
          {[
            ["Why", "#why"],
            ["How it works", "#how"],
            ["Journey", "#journey"],
            ["Chains", "#chains"],
            ["Flows", "#flows"],
          ].map(([l, h]) => (
            <a key={h} href={h} className="group relative">
              {l}
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-charcoal transition-all duration-300 group-hover:w-full" />
            </a>
          ))}
        </div>
        <a href="#start" className="btn btn-primary !px-5 !py-2 !text-sm">
          Get Started <Arrow />
        </a>
      </nav>
    </header>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`arrow ${className}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

/** Balance that looks encrypted until hovered by its owner. */
export function HiddenBalance() {
  const [shown, setShown] = useState(false);
  const [text, setText] = useState("••••••");
  useEffect(() => {
    const target = shown ? "$1,240.00" : "••••••";
    const glyphs = "0123456789#$%&*";
    let i = 0;
    const id = setInterval(() => {
      i++;
      setText(
        target
          .split("")
          .map((c, k) =>
            k < i ? c : glyphs[Math.floor(Math.random() * glyphs.length)],
          )
          .join(""),
      );
      if (i >= target.length) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [shown]);
  return (
    <button
      type="button"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
      className="group w-full text-left"
      aria-label="Bankroll, hover or focus to reveal"
    >
      <div className="eyebrow text-[0.65rem] text-ink-soft">Your bankroll</div>
      <div className="mt-1 font-serif text-4xl tabular-nums">{text}</div>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-olive" />
        {shown ? "Visible to you only" : "On-chain: account exists · amount encrypted"}
      </div>
    </button>
  );
}

/** The loss-limit demo: pick a cap, then try to bet past it. */
export function LimitDemo() {
  const [limit, setLimit] = useState(50);
  const [spent, setSpent] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [pulse, setPulse] = useState(0);
  const bet = 20;

  const place = () => {
    if (spent + bet > limit) {
      setBlocked(true);
      setPulse((p) => p + 1);
      return;
    }
    setBlocked(false);
    setSpent((s) => s + bet);
  };

  const pct = Math.min(100, (spent / limit) * 100);

  return (
    <div className="card !rounded-[1.75rem] p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-[0.65rem] text-ink-soft">Daily loss limit</div>
          <div className="mt-1 font-serif text-5xl tabular-nums">${limit}</div>
        </div>
        <span className="chip border border-olive/30 bg-sage text-olive">
          <Leaf /> Hard cap
        </span>
      </div>

      <input
        className="limit mt-6"
        type="range"
        min={20}
        max={200}
        step={10}
        value={limit}
        aria-label="Daily loss limit"
        style={{ ["--p" as string]: `${((limit - 20) / 180) * 100}%` }}
        onChange={(e) => {
          setLimit(Number(e.target.value));
          setBlocked(false);
        }}
      />

      <div className="mt-8 rounded-2xl border border-rule bg-cream p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-serif">Fed holds rates in December?</span>
          <span className="chip bg-butter/70">YES · $20</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full border border-charcoal/70 bg-sage">
            <div
              className="h-full rounded-full bg-olive transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-ink-soft">
            ${spent} / ${limit}
          </span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          key={pulse}
          type="button"
          onClick={place}
          className={`btn btn-primary ${blocked ? "shake" : ""}`}
        >
          Place $20 bet <Arrow />
        </button>
        <button
          type="button"
          onClick={() => {
            setSpent(0);
            setBlocked(false);
          }}
          className="link text-sm"
        >
          Reset day
        </button>
      </div>

      <div
        aria-live="polite"
        className={`mt-5 flex items-center gap-3 overflow-hidden rounded-xl border px-4 text-sm transition-all duration-500 ${
          blocked
            ? "max-h-20 border-[#d9a99c] bg-[var(--alert)] py-3 opacity-100"
            : "max-h-0 border-transparent py-0 opacity-0"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6M12 16.5v.5" strokeLinecap="round" />
        </svg>
        Blocked. This bet would pass your ${limit} limit. Nothing can override it, not even an agent.
      </div>
    </div>
  );
}

const FLOWS = [
  {
    id: "any",
    label: "Any chain",
    title: "Standard onboarding",
    steps: [
      ["Sign up", "Continue with fingerprint or Face ID. A Tempo passkey account, fees sponsored."],
      ["Set a loss limit", "Pick a daily or weekly ceiling. It opens a spend-limited session."],
      ["Fund", "Deposit from Base, Arbitrum, Ethereum or Solana into your confidential balance."],
      ["Bet", "One tap. Routed to Hyperliquid outcome markets."],
      ["Get paid", "Winnings land in your Tempo account in a stablecoin, with a receipt."],
    ],
  },
  {
    id: "zec",
    label: "Zcash",
    title: "The payment is the order",
    steps: [
      ["Scan", "Scan a payment-request QR and send shielded ZEC."],
      ["Encrypted memo", "The memo holds the market, side, size and a shielded return address."],
      ["Threshold relayer", "No single operator holds the money. The relayer executes the bet."],
      ["Shielded payout", "Winnings return as shielded ZEC to your address."],
      ["Prove selectively", "Share a viewing key to prove one payout, not your history."],
    ],
  },
  {
    id: "agent",
    label: "AI agent",
    title: "An agent under a cap",
    steps: [
      ["Fund the agent", "Open a spend-limited session for it."],
      ["It trades", "Through the API, paying per call for data and resolution evidence."],
      ["It stops", "It cannot spend past the limit. You see every receipt."],
    ],
  },
  {
    id: "hedge",
    label: "Bet & hedge",
    title: "Hedge a macro bet in one tap",
    steps: [
      ["Open a macro market", "For example, a Fed rate decision."],
      ["Take the hedge", "A matching index-ETF Stock Token on Robinhood Chain."],
      ["One tap", "The bet is placed and the hedge swapped through an open venue."],
      ["Live price", "Shown from the token's Chainlink price feed."],
      ["One receipt", "Payout and hedge P&L together. Eligible regions only."],
    ],
  },
];

export function FlowTabs() {
  const [active, setActive] = useState(0);
  const flow = FLOWS[active];
  return (
    <div>
      <div
        role="tablist"
        className="relative mx-auto flex w-fit flex-wrap justify-center gap-1 rounded-full border border-rule bg-paper p-1.5"
      >
        {FLOWS.map((f, i) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`relative rounded-full px-4 py-2 font-serif text-sm transition-colors duration-300 sm:px-5 ${
              i === active
                ? "bg-olive text-cream"
                : "text-charcoal hover:bg-sage/70"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div key={flow.id} className="mx-auto mt-12 max-w-4xl">
        <h3 className="text-center font-serif text-3xl sm:text-4xl">{flow.title}</h3>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {flow.steps.map(([t, d], i) => (
            <li
              key={t}
              className="card p-5 opacity-0"
              style={{
                animation: `flowIn .6s cubic-bezier(.2,.7,.2,1) ${i * 80}ms forwards`,
              }}
            >
              <div className="font-serif text-sm text-moss">0{i + 1}</div>
              <div className="mt-2 font-serif text-lg leading-snug">{t}</div>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{d}</p>
            </li>
          ))}
        </ol>
      </div>
      <style>{`@keyframes flowIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

/** Passkey button: a press-and-hold fingerprint with a success state. */
export function PasskeyButton() {
  const [state, setState] = useState<"idle" | "holding" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = () => {
    if (state === "done") return;
    setState("holding");
    timer.current = setTimeout(() => setState("done"), 900);
  };
  const stop = () => {
    clearTimeout(timer.current);
    setState((s) => (s === "done" ? s : "idle"));
  };
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && start()}
      onKeyUp={stop}
      className="group flex items-center gap-4 rounded-full border-[1.5px] border-charcoal bg-paper py-2 pl-2 pr-6 shadow-[0_3px_0_0_var(--charcoal)] transition-transform hover:-translate-y-0.5"
    >
      <span
        className={`relative grid h-11 w-11 place-items-center rounded-full transition-colors duration-500 ${
          state === "done" ? "bg-olive text-cream" : "bg-sage ring"
        }`}
      >
        {state === "done" ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
            className={state === "holding" ? "scale-90 transition-transform" : "transition-transform"}
          >
            <path d="M6.5 7.5A7 7 0 0 1 19 12v1.5M5 12a7 7 0 0 1 .4-2.3M8.5 19.5A10 10 0 0 0 9.5 12a2.5 2.5 0 0 1 5 0c0 2.6-.4 5-1.3 7.2M12 12c0 3-.6 5.6-1.8 8M17 15.5c-.2 1.5-.6 3-1.2 4.3" />
          </svg>
        )}
      </span>
      <span className="text-left">
        <span className="block font-serif text-base">
          {state === "done" ? "Account created" : "Continue with fingerprint"}
        </span>
        <span className="block text-xs text-ink-soft">
          {state === "done" ? "No seed phrase. Zero gas." : "Press and hold"}
        </span>
      </span>
    </button>
  );
}

export function Leaf() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15ZM5 19l8-8" />
    </svg>
  );
}
