"use client";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useDeferredValue, useState } from "react";
import { api, cents, newKey, ok, usd } from "../../../_app/api";
import { useBalance, useLimit, useMarketEvents, useMe, useVenues } from "../../../_app/hooks";
import { Empty, ErrorNote, PageHead, SimBadge, Stat } from "../../../_app/ui";

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
        Hedge available: {o.stock} <SimBadge />
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
  const blocker = !signedIn
    ? "Sign in to bet"
    : !limit.data?.limit
      ? "Set a loss limit first"
      : remaining !== undefined && stake > remaining
        ? `Over your loss limit (${usd(remaining)} left)`
        : balance.data && stake > balance.data.availableUsd
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
        <section>
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
                          <SimBadge live={info?.mode === "live"} /> settles on {info?.settlementChain}
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
            <div className="mt-6">
              <h2 className="font-serif text-2xl">How tyr would fill {usd(stake, 0)}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Stat label="Contracts" value={q.contracts.toFixed(1)} sub={`avg ${cents(q.avgAllInPx)} all-in`} />
                <Stat label="Pays if right" value={usd(q.contracts)} sub={`cost ${usd(q.costUsd)}`} />
                <Stat label="Vs worst venue" value={`+${q.edgeVsWorst.toFixed(1)}`} sub="extra contracts" />
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                {q.legs.map((l) => (
                  <li key={l.marketId} className="panel flex justify-between px-4 py-2">
                    <span>
                      {mode.get(l.venue)?.name ?? l.venue} · {l.sz.toFixed(1)} @ {cents(l.avgPx)}
                    </span>
                    <span className="num text-ink-soft">
                      {usd(l.costUsd)} + {usd(l.feeUsd)} fee
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hl && <HedgeCard outcome={hl.marketId.split(":")[1] ?? ""} />}
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
          <p className="mt-2 text-xs text-ink-soft">
            Hyperliquid has a $10 minimum order. Your stake is authorized on Tempo (counts against your limit) and
            escrowed from your hidden balance.
          </p>
          <button type="button" className="btn btn-primary mt-5 w-full justify-center" disabled={!!blocker || bet.isPending || !q} onClick={() => bet.mutate()}>
            {bet.isPending ? "Placing across venues…" : (blocker ?? `Bet ${usd(stake, 0)} on ${side.toUpperCase()}`)}
          </button>
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
