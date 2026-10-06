import Image from "next/image";
import {
  Arrow,
  FlowTabs,
  HiddenBalance,
  LimitDemo,
  Nav,
  PasskeyButton,
  Reveal,
  SmoothScroll,
} from "./_landing/interactive";
import { HeroScene } from "./_landing/hero-scene";
import { HeroTitle, Journey } from "./_landing/journey";

const Icon = ({ d }: { d: string }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const ICONS = {
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  knot: "M4 7h10a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h12M17 4l3 3-3 3",
  scatter: "M5 5h3v3H5zM16 4h3v3h-3zM10 11h3v3h-3zM4 16h3v3H4zM17 15h3v3h-3z",
  finger: "M6.5 7.5A7 7 0 0 1 19 12v1.5M5 12a7 7 0 0 1 .4-2.3M8.5 19.5A10 10 0 0 0 9.5 12a2.5 2.5 0 0 1 5 0c0 2.6-.4 5-1.3 7.2M12 12c0 3-.6 5.6-1.8 8",
  fund: "M12 3v12M7 10l5 5 5-5M4 19h16",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6",
};

const PROBLEMS = [
  { icon: ICONS.eye, title: "Public", body: "Anyone can see your balance, your bets, and your wallet history." },
  { icon: ICONS.knot, title: "Annoying to use", body: "You need a wallet, the right chain, gas tokens, and a seed phrase." },
  { icon: ICONS.scatter, title: "Fragmented", body: "Liquidity is spread over many venues." },
];

const STEPS = [
  { icon: ICONS.finger, title: "Sign up with a fingerprint", body: "No seed phrase, no gas." },
  { icon: ICONS.fund, title: "Fund it privately", body: "From any chain, or by sending shielded Zcash with a message that is the bet." },
  { icon: ICONS.lock, title: "Keep your bankroll hidden", body: "In an encrypted balance on Solana." },
  { icon: ICONS.chart, title: "Trade on the deepest venue", body: "Hyperliquid's outcome markets. For macro events, hedge in one tap with an index-ETF Stock Token." },
  { icon: ICONS.shield, title: "Set a hard loss limit", body: "That nothing, including an AI agent, can exceed." },
  { icon: ICONS.receipt, title: "Get paid", body: "Into a simple stablecoin account, with receipts you can prove or keep private." },
];

const CHAINS = [
  ["Tempo", "Home account", "Passkey login, gasless, spend limits, receipts, payouts, agent API."],
  ["Zcash", "Private entry", "A shielded payment with an encrypted memo is the order."],
  ["Solana", "Confidential custody", "Confidential Balances hide balances and amounts natively."],
  ["Hyperliquid", "Execution", "Native outcome markets sharing one deep order book."],
  ["Robinhood Chain", "Bet and hedge", "24/7 tokenized stocks with an official Chainlink price feed per token."],
  ["Base · Arbitrum · Ethereum", "Deposit sources", "Users already hold funds there."],
];

const CHAIN_LOGOS = [
  ["tempo", "Tempo"],
  ["zcash", "Zcash"],
  ["solana", "Solana"],
  ["hyperliquid", "Hyperliquid"],
  ["robinhood", "Robinhood Chain"],
  ["base", "Base"],
  ["arbitrum", "Arbitrum"],
  ["ethereum", "Ethereum"],
];

export default function Home() {
  return (
    <>
      <SmoothScroll />
      <Nav />
      <main id="top" className="overflow-x-clip">
        {/* HERO */}
        <HeroScene>
          <div className="mx-auto max-w-5xl px-4 text-center">
            <HeroTitle />
            <Reveal delay={700}>
              <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-ink-soft">
                With a hidden bankroll and a loss limit you can&apos;t break. Sign up with a
                fingerprint. No seed phrase, no gas.
              </p>
            </Reveal>
            <Reveal delay={850}>
              <div id="start" className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <PasskeyButton />
                <a href="#how" className="btn btn-secondary">
                  See how it works <Arrow />
                </a>
              </div>
            </Reveal>
          </div>
        </HeroScene>

        {/* MARQUEE */}
        <div className="relative z-10 overflow-hidden py-8 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          <div className="marquee flex w-max items-center gap-20 whitespace-nowrap pr-20 font-serif text-xl">
            {Array.from({ length: 2 }).flatMap((_, k) =>
              CHAIN_LOGOS.map(([slug, name]) => (
                <span key={`${k}${slug}`} className="group" aria-hidden={k === 1}>
                  <span className="flex items-center gap-4 text-charcoal/75 transition-colors duration-300 group-hover:text-charcoal">
                    <span
                      className="h-11 w-11 bg-current transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110"
                      style={{
                        mask: `url(/chains/${slug}.svg) center / contain no-repeat`,
                        WebkitMask: `url(/chains/${slug}.svg) center / contain no-repeat`,
                      }}
                    />
                    {name}
                  </span>
                </span>
              )),
            )}
          </div>
        </div>

        {/* WHY */}
        <section id="why" className="mx-auto max-w-6xl px-4 py-28 sm:py-36">
          <Reveal>
            <p className="eyebrow text-olive">The problem</p>
            <h2 className="mt-4 max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">
              Prediction markets are the hottest category in crypto. Today they are:
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <Reveal key={p.title} delay={i * 110}>
                <article className="card group h-full p-7">
                  <div className="grid h-12 w-12 place-items-center rounded-full border border-charcoal/70 bg-butter transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110">
                    <Icon d={p.icon} />
                  </div>
                  <h3 className="mt-6 font-serif text-2xl">{p.title}.</h3>
                  <p className="mt-2 leading-relaxed text-ink-soft">{p.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* HOW */}
        <section id="how" className="relative bg-paper py-28 sm:py-36">
          <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-4 text-charcoal/60">
            <span className="h-px w-24 bg-current" />
            <span className="-mt-px text-lg">✦</span>
            <span className="h-px w-24 bg-current" />
          </div>
          <div className="mx-auto grid max-w-6xl gap-16 px-4 lg:grid-cols-[1fr_1.15fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Reveal>
                <p className="eyebrow text-olive">How Tyr works</p>
                <h2 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">
                  Six quiet steps.
                  <br />
                  <em className="text-moss">None of them public.</em>
                </h2>
                <p className="mt-6 max-w-md leading-relaxed text-ink-soft">
                  Try it: hover the bankroll. The world sees an account. Only you see the amount.
                </p>
              </Reveal>
              <Reveal delay={150}>
                <div className="card mt-10 flex items-center gap-6 p-6">
                  <Image src="/brand/logo-nobg.png" alt="" width={84} height={84} className="breathe shrink-0" />
                  <HiddenBalance />
                </div>
              </Reveal>
            </div>

            <ol className="relative space-y-4 before:absolute before:left-[1.65rem] before:top-6 before:bottom-6 before:w-px before:bg-charcoal/20">
              {STEPS.map((s, i) => (
                <Reveal key={s.title} delay={i * 60}>
                  <li className="group relative flex gap-5 rounded-2xl p-3 transition-colors duration-300 hover:bg-cream">
                    <div className="relative z-10 grid h-[3.3rem] w-[3.3rem] shrink-0 place-items-center rounded-full border border-charcoal/70 bg-sage transition-colors duration-300 group-hover:bg-butter">
                      <Icon d={s.icon} />
                    </div>
                    <div className="pt-1.5">
                      <div className="flex items-baseline gap-3">
                        <span className="font-serif text-sm text-moss">0{i + 1}</span>
                        <h3 className="font-serif text-xl sm:text-2xl">{s.title}</h3>
                      </div>
                      <p className="mt-1.5 leading-relaxed text-ink-soft">{s.body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <Journey />

        {/* LIMIT */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-28 sm:py-36 lg:grid-cols-2">
          <Reveal>
            <p className="eyebrow text-olive">A limit you can&apos;t break</p>
            <h2 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">
              Pick a ceiling once. <em className="text-moss">Sleep well.</em>
            </h2>
            <p className="mt-6 max-w-md leading-relaxed text-ink-soft">
              Your daily or weekly limit opens a spend-limited session. Past it, the bet is
              blocked. Not by a setting someone can change, but by the session itself.
            </p>
            <p className="mt-8 font-hand text-3xl text-olive">small stakes, brighter days.</p>
          </Reveal>
          <Reveal delay={150}>
            <LimitDemo />
          </Reveal>
        </section>

        {/* CHAINS */}
        <section id="chains" className="relative overflow-hidden bg-olive py-28 text-cream sm:py-36">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal>
              <p className="eyebrow text-butter">Why each chain is here</p>
              <h2 className="mt-4 max-w-3xl font-serif text-4xl leading-tight sm:text-5xl">
                Each chain does one job only it can do.
              </h2>
            </Reveal>
            <div className="mt-14 border-t border-cream/25">
              {CHAINS.map(([name, job, why], i) => (
                <Reveal key={name} delay={i * 50}>
                  <div className="group grid gap-2 border-b border-cream/25 py-6 transition-all duration-500 hover:bg-cream/[.06] hover:px-4 md:grid-cols-[1.1fr_0.9fr_1.6fr] md:items-baseline md:gap-8">
                    <div className="flex items-center gap-3 font-serif text-2xl sm:text-3xl">
                      <span className="text-butter opacity-0 transition-all duration-500 group-hover:opacity-100 max-md:hidden">✦</span>
                      <span className="transition-transform duration-500 md:-ml-7 md:group-hover:ml-0">{name}</span>
                    </div>
                    <div className="eyebrow text-[0.7rem] text-butter">{job}</div>
                    <p className="text-cream/80">{why}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* FLOWS */}
        <section id="flows" className="px-4 py-28 sm:py-36">
          <Reveal className="text-center">
            <p className="eyebrow text-olive">Four ways in</p>
            <h2 className="mx-auto mt-4 max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">
              For people, for privacy, for agents, for hedgers.
            </h2>
          </Reveal>
          <Reveal delay={120} className="mt-12">
            <FlowTabs />
          </Reveal>
        </section>

        {/* CTA */}
        <section className="px-4 pb-24">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-charcoal/80">
            <Image
              src="/brand/image.png"
              alt="Engraved sea at sunset with mountains, islands and a pine on a cliff"
              width={1672}
              height={941}
              sizes="(min-width: 1152px) 1152px, 100vw"
              className="h-[34rem] w-full object-cover transition-transform duration-[2000ms] ease-out hover:scale-105 sm:h-auto"
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-start justify-start p-8 sm:p-14">
              <p className="eyebrow text-charcoal/80">A calmer day ahead</p>
              <h2 className="mt-4 max-w-lg font-serif text-4xl leading-[1.05] sm:text-6xl">
                Your bets. <br />
                <em>Your business.</em>
              </h2>
              <a href="/start" className="btn btn-primary pointer-events-auto mt-8">
                Get Started <Arrow />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row">
          <div className="flex items-center gap-3">
            <Image src="/brand/logo-nobg.png" alt="" width={40} height={40} />
            <span className="font-serif text-2xl font-semibold">TYR</span>
          </div>
          <p className="text-center text-sm text-ink-soft">
            Bet on anything, from any chain, with a hidden bankroll.
          </p>
          <p className="eyebrow text-[0.65rem] text-ink-soft">© 2026 Tyr</p>
        </div>
      </footer>
    </>
  );
}
