"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Order } from "@tyr/api-client";
import Link from "next/link";
import { useState } from "react";
import { api, cents, explorer, ok, usd } from "../../_app/api";
import { useBalance, useLimit, useMe } from "../../_app/hooks";
import { DEMO, demoBalanceUsd, demoBets, demoDeposits, demoReceipts, orDemo } from "../../_app/demo";
import { Empty, ErrorNote, PageHead, Stat, TxLink } from "../../_app/ui";

const STEP: Record<string, string> = {
  created: "Created",
  staked: "Stake authorized on Tempo",
  escrowed: "Escrowed on Solana",
  opened: "Position opened",
  executed: "Filled",
  settled: "Settled",
  refunded: "Refunded",
};

function Hedge({ order }: { order: Order }) {
  const qc = useQueryClient();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState(me.data?.region ?? "");
  const quote = useQuery({
    queryKey: ["hedge-quote", order.id],
    queryFn: () => ok(api.GET("/api/hedge/{orderId}/quote", { params: { path: { orderId: order.id }, query: {} } })),
    enabled: open && !!me.data?.region,
    retry: false,
  });
  const setReg = useMutation({
    mutationFn: () => ok(api.PUT("/api/auth/region", { body: { region } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const place = useMutation({
    mutationFn: () => ok(api.POST("/api/hedge", { body: { orderId: order.id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hedges"] }),
  });

  if (!open)
    return (
      <button type="button" className="chip border border-charcoal" onClick={() => setOpen(true)}>
        Hedge with a Stock Token
      </button>
    );
  return (
    <div className="mt-3 w-full rounded-xl bg-cream p-4 text-sm">
      {!me.data?.region ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Your country (ISO code, self-declared):</span>
          <input className="field !w-20 !py-1" maxLength={2} value={region} onChange={(e) => setRegion(e.target.value.toUpperCase())} />
          <button type="button" className="chip border border-charcoal" disabled={region.length !== 2} onClick={() => setReg.mutate()}>
            Save
          </button>
        </div>
      ) : quote.data ? (
        <div>
          <p className="flex items-center gap-2">
            {quote.data.direction} {quote.data.shares.toFixed(4)} {quote.data.stock} for {usd(quote.data.amountInUsd)} @{" "}
            {usd(quote.data.entryPx)}
          </p>
          <p className="text-ink-soft">Price: {quote.data.priceSource} · fee {quote.data.feeBps}bp · {quote.data.rule}</p>
          {place.isSuccess ? (
            <p className="mt-2 text-olive">Hedge open. It closes when the bet settles.</p>
          ) : (
            <button type="button" className="btn btn-primary btn-sm mt-3" disabled={place.isPending} onClick={() => place.mutate()}>
              Open hedge
            </button>
          )}
        </div>
      ) : (
        <p className="text-ink-soft">{quote.isLoading ? "Quoting…" : ""}</p>
      )}
      <ErrorNote error={quote.error ?? setReg.error ?? place.error} />
    </div>
  );
}

function Bet({ o }: { o: Order }) {
  const s = o.settlement;
  const venue = o.marketId.split(":")[0];
  return (
    <div className="panel px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            <span className={o.side === "yes" ? "text-olive" : ""}>{o.side.toUpperCase()}</span> · {usd(o.stakeUsd)} on{" "}
            <span className="capitalize">{venue}</span>
          </p>
          {o.hlMarket && <p className="mt-0.5 font-serif text-lg">{o.hlMarket}</p>}
          <p className="num mt-0.5 text-sm text-ink-soft">
            {Number(o.filledSize).toFixed(2)} contracts{o.avgPx ? ` @ ${cents(Number(o.avgPx))}` : ""} · {new Date(o.createdAt).toLocaleString()}
          </p>
        </div>
        <span className={`chip ${s ? "bg-sage" : o.status === "failed" ? "bg-[var(--alert)]" : "bg-butter"}`}>
          {s ? `${s.outcome} · paid ${usd(s.payoutUsd)}` : (STEP[o.step] ?? o.step)}
        </span>
      </div>
      {o.error && <p className="mt-2 text-sm text-ink-soft">{o.error}</p>}
      <div className="mt-3 flex flex-wrap gap-4">
        {o.tempoStakeTx && <TxLink href={explorer.tempo(o.tempoStakeTx)} label="Tempo stake" />}
        {o.escrowTx && <TxLink href={explorer.solana(o.escrowTx)} label="Solana escrow" />}
        {o.solanaOpenTx && <TxLink href={explorer.solana(o.solanaOpenTx)} label="Position" />}
        {s?.solanaTx && <TxLink href={explorer.solana(s.solanaTx)} label="Settlement" />}
        {s?.tempoPayoutTx && <TxLink href={explorer.tempo(s.tempoPayoutTx)} label="Tempo payout" />}
      </div>
      {!s && o.step === "executed" && venue === "hyperliquid" && <div className="mt-3"><Hedge order={o} /></div>}
    </div>
  );
}

const VENUE_COLOR: Record<string, string> = {
  hyperliquid: "bg-olive",
  polymarket: "bg-moss",
  kalshi: "bg-butter-deep",
  limitless: "bg-charcoal",
};

/** Share of staked dollars per venue, as one stacked bar plus a legend. */
function Exposure({ bets }: { bets: Order[] }) {
  const by = new Map<string, number>();
  for (const o of bets) by.set(o.marketId.split(":")[0]!, (by.get(o.marketId.split(":")[0]!) ?? 0) + Number(o.stakeUsd ?? 0));
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
  if (!total) return <Empty>Your exposure by venue appears after your first bet.</Empty>;
  return (
    <div className="panel p-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-cream">
        {rows.map(([v, n]) => (
          <div key={v} className={VENUE_COLOR[v] ?? "bg-ink-soft"} style={{ width: `${(n / total) * 100}%` }} title={`${v} ${usd(n)}`} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {rows.map(([v, n]) => (
          <li key={v} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 capitalize">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${VENUE_COLOR[v] ?? "bg-ink-soft"}`} />
              {v}
            </span>
            <span className="num text-ink-soft">
              {usd(n)} · {((n / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Activity = { at: string; title: string; detail: string; tone: "in" | "out" | "neutral" };

function ActivityFeed({ items }: { items: Activity[] }) {
  if (!items.length) return <Empty>Deposits, bets and payouts show up here.</Empty>;
  return (
    <ol className="panel divide-y divide-rule">
      {items.slice(0, 8).map((a, i) => (
        <li key={i} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${a.tone === "in" ? "bg-olive" : a.tone === "out" ? "bg-butter-deep" : "bg-ink-soft"}`} />
            <div className="min-w-0">
              <p className="truncate font-medium">{a.title}</p>
              <p className="truncate text-ink-soft">{a.detail}</p>
            </div>
          </div>
          <span className="num shrink-0 text-ink-soft">{new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </li>
      ))}
    </ol>
  );
}

export default function PortfolioPage() {
  const [reveal, setReveal] = useState(false);
  const balance = useBalance(reveal);
  const limit = useLimit();
  const bets = useQuery({ queryKey: ["bets"], queryFn: () => ok(api.GET("/api/bets")), refetchInterval: 15_000 });
  const receipts = useQuery({ queryKey: ["receipts"], queryFn: () => ok(api.GET("/api/receipts")) });
  const deposits = useQuery({ queryKey: ["deposits"], queryFn: () => ok(api.GET("/api/deposits")) });
  const all = orDemo(bets.data?.bets, demoBets);
  const open = all.filter((o) => !o.settlement);
  const done = all.filter((o) => o.settlement);
  const l = limit.data?.limit;

  const atRisk = open.reduce((a, o) => a + Number(o.stakeUsd ?? 0), 0);
  const realized = done.reduce((a, o) => a + Number(o.settlement!.pnl), 0);
  const wins = done.filter((o) => Number(o.settlement!.pnl) > 0).length;
  const used = l ? Math.min(100, ((Number(l.amountUsd) - Number(l.remainingUsd)) / Number(l.amountUsd)) * 100) : 0;

  const activity: Activity[] = [
    ...orDemo<{ createdAt: string; amount: string; asset: string; sourceChain: string; status: string }>(deposits.data?.deposits, demoDeposits).map((d) => ({
      at: d.createdAt,
      title: `Deposited ${Number(d.amount).toLocaleString()} ${d.asset}`,
      detail: `from ${d.sourceChain} · ${d.status}`,
      tone: "in" as const,
    })),
    ...all.map((o) => ({
      at: o.createdAt,
      title: `${o.side.toUpperCase()} ${usd(o.stakeUsd)} on ${o.marketId.split(":")[0]}`,
      detail: o.hlMarket ?? o.marketId,
      tone: "out" as const,
    })),
    ...done.map((o) => ({
      at: o.settlement!.createdAt,
      title: `Settled ${o.settlement!.outcome} · paid ${usd(o.settlement!.payoutUsd)}`,
      detail: `P&L ${Number(o.settlement!.pnl) >= 0 ? "+" : ""}${usd(o.settlement!.pnl)}`,
      tone: Number(o.settlement!.pnl) >= 0 ? ("in" as const) : ("neutral" as const),
    })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <div>
      <PageHead eyebrow="Portfolio" title="Your book">
        Your balance is a confidential balance on Solana: only you can decrypt it. Every bet below is staked against your
        loss limit on Tempo, escrowed on Solana, and routed to the venue with the best price.
      </PageHead>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel px-5 py-4">
          <p className="eyebrow !text-[0.65rem] text-ink-soft">Hidden balance</p>
          <p className="num mt-1 font-serif text-3xl">{reveal ? usd(balance.data?.availableUsd || (DEMO ? demoBalanceUsd : balance.data?.availableUsd)) : "$••••"}</p>
          <button type="button" className="link mt-1 text-sm" onClick={() => setReveal((r) => !r)}>
            {reveal ? "Hide" : "Decrypt for me"}
          </button>
        </div>
        <Stat label="At risk" value={usd(atRisk)} sub={`${open.length} open bet${open.length === 1 ? "" : "s"}`} />
        <Stat
          label="Realized P&L"
          value={<span className={realized > 0 ? "text-olive" : ""}>{realized > 0 ? "+" : ""}{usd(realized)}</span>}
          sub={done.length ? `${wins} of ${done.length} won · ${((wins / done.length) * 100).toFixed(0)}%` : "Nothing settled yet"}
        />
        <div className="panel px-5 py-4">
          <p className="eyebrow !text-[0.65rem] text-ink-soft">Loss limit left</p>
          <p className="num mt-1 font-serif text-3xl">{l ? usd(l.remainingUsd) : "—"}</p>
          {l ? (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream">
                <div className="h-full bg-olive" style={{ width: `${100 - used}%` }} />
              </div>
              <p className="mt-1 text-sm text-ink-soft">of {usd(l.amountUsd, 0)} per {l.period} · enforced on Tempo</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">Not set</p>
          )}
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <section>
          <h2 className="font-serif text-2xl">Exposure by venue</h2>
          <div className="mt-4">
            <Exposure bets={open.length ? open : all} />
          </div>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Activity</h2>
          <div className="mt-4">
            <ActivityFeed items={activity} />
          </div>
        </section>
      </div>

      <h2 className="mt-12 font-serif text-2xl">Open</h2>
      <div className="mt-4 space-y-3">
        {open.length ? open.map((o) => <Bet key={o.id} o={o} />) : <Empty>No open bets. <Link className="link" href="/markets">Browse markets</Link></Empty>}
      </div>

      <h2 className="mt-12 font-serif text-2xl">Settled</h2>
      <div className="mt-4 space-y-3">{done.length ? done.map((o) => <Bet key={o.id} o={o} />) : <Empty>Nothing settled yet.</Empty>}</div>

      <h2 className="mt-12 font-serif text-2xl">Receipts</h2>
      <p className="mt-1 text-sm text-ink-soft">Proof of each settlement, anchored on Tempo and Solana. Private unless you choose to share.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {orDemo(receipts.data?.receipts, demoReceipts).length ? (
          orDemo(receipts.data?.receipts, demoReceipts).map((r) => (
            <Link key={r.id} href={r.id.startsWith("demo") ? "#" : `/receipts/${r.id}`} className="card block px-5 py-4">
              <p className="font-medium">{r.kind} receipt</p>
              <p className="mono mt-1 text-ink-soft">{r.payloadHash.slice(0, 22)}…</p>
              <span className={`chip mt-2 ${r.visibility === "public" ? "bg-butter" : "bg-sage"}`}>{r.visibility}</span>
            </Link>
          ))
        ) : (
          <Empty>Receipts appear when a bet settles.</Empty>
        )}
      </div>
      <ErrorNote error={bets.error} />
    </div>
  );
}
