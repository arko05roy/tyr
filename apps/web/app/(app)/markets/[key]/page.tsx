"use client";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useDeferredValue, useEffect, useState } from "react";
import { api, cents, newKey, ok, usd } from "../../../_app/api";
import { useBalance, useLimit, useMarketEvents, useMe, useVenues } from "../../../_app/hooks";
import { DEMO, demoBalanceUsd } from "../../../_app/demo";
import { MarketStats, OrderBook, PriceChart, RecentFills, Resolution } from "../../../_app/market-extras";
import { RouteMap } from "../../../_app/route-map";
import { Empty, ErrorNote, PageHead } from "../../../_app/ui";

const DEMO_STEPS = ["Stake authorized on Tempo", "Escrowed on Solana", "Routed to best venue", "Position opened"];

function HedgeCard({ outcome }: { outcome: string }) {
  const offer = useQuery({
    queryKey: ["hedge-offer", outcome],
    queryFn: () => ok(api.GET("/api/hedge/markets/{marketId}", { params: { path: { marketId: Number(outcome) } } })),
    retry: false,
  });
  const o = offer.data as { offered?: boolean; stock?: string; yesDirection?: string; rule?: string } | undefined;
  if (!o?.offered) return null;
  return (
    <div className="panel mt-6 border-dashed p-5">
      <p className="flex items-center gap-2 font-serif text-lg">
        Hedge available: {o.stock}
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        A YES bet pairs with a {o.yesDirection} of the {o.stock} Stock Token on Robinhood Chain ({o.rule}). Add it from
        Portfolio once your bet fills. Not offered in US, CA, GB, CH or AE.
      </p>
    </div>
  );
}

export default function EventPage({ params }: { params: Promise<{ key: string }> }) {
  const eventKey = decodeURIComponent(use(params).key);
  const router = useRouter();
  const me = useMe();
  const signedIn = !!me.data;
  const events = useMarketEvents();
  const venues = useVenues();
  const limit = useLimit(signedIn);
  const balance = useBalance(signedIn);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [stake, setStake] = useState(25);
  const stakeQ = useDeferredValue(stake);
  const [key] = useState(newKey);
  // Demo fill (dashboard only): walks the real saga's steps without touching the chain.
  const [demoStep, setDemoStep] = useState(-1);
  useEffect(() => {
    if (demoStep < 0 || demoStep >= DEMO_STEPS.length) return;
    const t = setTimeout(() => setDemoStep((n) => n + 1), 900);
    return () => clearTimeout(t);
  }, [demoStep]);

  const ev = events.data?.events.find((e) => e.eventKey === eventKey);
  const mode = new Map(venues.data?.venues.map((v) => [v.id, v]) ?? []);
  const quote = useQuery({
    queryKey: ["route", eventKey, side, stakeQ],
    queryFn: () => ok(api.POST("/api/venues/route", { body: { eventKey, side, stakeUsd: stakeQ } })),
    enabled: !!ev && stakeQ > 0,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const bet = useMutation({
    mutationFn: () =>
      ok(api.POST("/api/bets/routed", { body: { eventKey, side, stakeUsd: stake, idempotencyKey: key } })),
    onSuccess: () => router.push("/portfolio"),
  });

  if (!ev) return <Empty>{events.isLoading ? "Loading…" : "This market isn't listed anymore."}</Empty>;
  const q = quote.data;
  const hl = ev.venues.find((v) => v.venue === "hyperliquid");
  const remaining = limit.data?.limit?.remainingUsd;
  // On the dashboard the demo balance tops up the real one; a stake the real balance can't cover
  // plays the simulated fill instead of hitting the chain.
  const real = balance.data?.availableUsd ?? 0;
  const available = DEMO ? Math.max(real, demoBalanceUsd) : balance.data?.availableUsd;
  const simulate = DEMO && stake > real;
  const px = side === "yes" ? ev.bestYesAsk.px : ev.bestNoAsk.px;
  const contracts = stake / px;
  const best = ev.venues.find((v) => v.venue === ev.bestYesAsk.venue) ?? ev.venues[0]!;
  const liquidity = ev.venues.reduce((a, v) => a + v.liquidityUsd, 0);
  const blocker = !signedIn
    ? "Sign in to bet"
    : !limit.data?.limit
      ? "Set a loss limit first"
      : remaining !== undefined && stake > remaining
        ? `Over your loss limit (${usd(remaining)} left)`
        : available !== undefined && stake > available
          ? "Not enough in your hidden balance"
          : null;

  return (
    <div>
      <Link href="/markets" className="link text-sm">
        ← All markets
      </Link>
      <div className="mt-4">
        <PageHead eyebrow={`${ev.category} · resolves ${new Date(ev.resolvesAt).toLocaleDateString()}`} title={ev.title} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <section className="space-y-6">
          {DEMO && (
            <>
              <PriceChart seed={eventKey} yes={ev.bestYesAsk.px} />
              <MarketStats seed={eventKey} liquidity={liquidity} venues={ev.venues.length} />
            </>
          )}
          <div className="panel overflow-hidden">
            <table className="num w-full text-sm">
              <thead className="bg-cream text-left text-ink-soft">
                <tr>
                  <th className="px-5 py-3 font-normal">Venue</th>
                  <th className="font-normal">Yes ask</th>
                  <th className="font-normal">No ask</th>
                  <th className="pr-5 text-right font-normal">Liquidity</th>
                </tr>
              </thead>
              <tbody>
                {ev.venues.map((v) => {
                  const info = mode.get(v.venue);
                  return (
                    <tr key={v.marketId} className="border-t border-rule">
                      <td className="px-5 py-3">
                        <p className="font-medium">{info?.name ?? v.venue}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
                          Settles on {info?.settlementChain}
                        </p>
                      </td>
                      <td>{cents(v.yesAsk)}</td>
                      <td>{cents(1 - v.yesBid)}</td>
                      <td className="pr-5 text-right">{usd(v.liquidityUsd, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {q && (
            <div>
              <RouteMap
                q={q}
                names={(v) => mode.get(v as never)?.name ?? v}
                stale={quote.isPlaceholderData || quote.isFetching}
              />
            </div>
          )}
          {hl && <HedgeCard outcome={hl.marketId.split(":")[1] ?? ""} />}
          {DEMO && (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <OrderBook seed={eventKey} ask={best.yesAsk} bid={best.yesBid} venue={mode.get(best.venue)?.name ?? best.venue} />
                <RecentFills seed={eventKey} yes={ev.bestYesAsk.px} venues={ev.venues.map((v) => mode.get(v.venue)?.name ?? v.venue)} />
              </div>
              <Resolution category={ev.category} resolvesAt={ev.resolvesAt} />
            </>
          )}
        </section>

        <aside className="panel h-fit p-6 lg:sticky lg:top-24">
          <div className="grid grid-cols-2 gap-2">
            {(["yes", "no"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`rounded-xl border-[1.5px] border-charcoal py-3 font-serif text-lg capitalize ${side === s ? (s === "yes" ? "bg-sage" : "bg-[var(--alert)]") : ""}`}
              >
                {s} {cents(s === "yes" ? ev.bestYesAsk.px : ev.bestNoAsk.px)}
              </button>
            ))}
          </div>
          <label className="mt-5 block text-sm text-ink-soft">
            Stake (USD)
            <input className="field mt-1 text-lg" type="number" min={1} max={1000} value={stake} onChange={(e) => setStake(Number(e.target.value))} />
          </label>
          <div className="mt-3 flex gap-2">
            {[10, 25, 50, 100].map((v) => (
              <button key={v} type="button" onClick={() => setStake(v)} className={`chip num flex-1 justify-center border border-charcoal ${stake === v ? "bg-sage" : ""}`}>
                ${v}
              </button>
            ))}
          </div>
          <dl className="num mt-5 space-y-1.5 border-t border-rule pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Avg price</dt>
              <dd>{cents(q?.legs.length ? q.legs.reduce((a, l) => a + l.costUsd, 0) / q.legs.reduce((a, l) => a + l.sz, 0) : px)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Contracts</dt>
              <dd>{contracts.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">Payout if {side.toUpperCase()}</dt>
              <dd className="font-semibold text-olive">
                {usd(contracts)} <span className="font-normal">(+{(((1 - px) / px) * 100).toFixed(0)}%)</span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-soft">
            {hl && "Hyperliquid has a $10 minimum order. "}Your stake is authorized on Tempo (counts against your limit)
            and escrowed from your hidden balance.
          </p>
          {demoStep >= 0 ? (
            <div className="mt-5 rounded-xl bg-cream p-4 text-sm">
              <ol className="space-y-2">
                {DEMO_STEPS.map((label, i) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${demoStep > i ? "bg-olive" : demoStep === i ? "breathe bg-butter-deep" : "border border-ink-soft"}`} />
                    <span className={demoStep >= i ? "" : "text-ink-soft"}>{label}</span>
                  </li>
                ))}
              </ol>
              {demoStep >= DEMO_STEPS.length && (
                <div className="mt-4 border-t border-rule pt-3">
                  <p className="font-medium text-olive">
                    Filled: {contracts.toFixed(2)} {side.toUpperCase()} @ {cents(px)} on {mode.get(ev.bestYesAsk.venue)?.name ?? ev.bestYesAsk.venue}
                  </p>
                  <Link href="/portfolio" className="link mt-2 inline-block text-sm">
                    View in portfolio →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary mt-5 w-full justify-center"
              disabled={!!blocker || bet.isPending || (!q && !simulate)}
              onClick={() => (simulate ? setDemoStep(0) : bet.mutate())}
            >
              {bet.isPending ? "Placing across venues…" : (blocker ?? `Bet ${usd(stake, 0)} on ${side.toUpperCase()}`)}
            </button>
          )}
          {blocker === "Sign in to bet" && (
            <Link href={`/start?next=${encodeURIComponent(`/markets/${encodeURIComponent(eventKey)}`)}`} className="link mt-3 text-sm">
              Sign in with passkey
            </Link>
          )}
          {blocker === "Set a loss limit first" && (
            <Link href="/onboarding/limit" className="link mt-3 text-sm">
              Set loss limit
            </Link>
          )}
          <ErrorNote error={bet.error ?? quote.error} />
        </aside>
      </div>
    </div>
  );
}
