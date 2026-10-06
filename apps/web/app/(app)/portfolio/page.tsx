"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Order } from "@tyr/api-client";
import Link from "next/link";
import { useState } from "react";
import { api, cents, explorer, ok, usd } from "../../_app/api";
import { useBalance, useLimit, useMe } from "../../_app/hooks";
import { Empty, ErrorNote, PageHead, SimBadge, Stat, TxLink } from "../../_app/ui";

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
            {usd(quote.data.entryPx)} <SimBadge />
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
            <span className="capitalize">{venue}</span> {o.simulated && <SimBadge />}
          </p>
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

export default function PortfolioPage() {
  const [reveal, setReveal] = useState(false);
  const balance = useBalance(reveal);
  const limit = useLimit();
  const bets = useQuery({ queryKey: ["bets"], queryFn: () => ok(api.GET("/api/bets")), refetchInterval: 15_000 });
  const receipts = useQuery({ queryKey: ["receipts"], queryFn: () => ok(api.GET("/api/receipts")) });
  const all = bets.data?.bets ?? [];
  const open = all.filter((o) => !o.settlement);
  const done = all.filter((o) => o.settlement);
  const l = limit.data?.limit;

  return (
    <div>
      <PageHead eyebrow="Portfolio" title="Your book" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel px-5 py-4">
          <p className="eyebrow !text-[0.65rem] text-ink-soft">Hidden balance</p>
          <p className="num mt-1 font-serif text-3xl">{reveal ? usd(balance.data?.availableUsd) : "$••••"}</p>
          <button type="button" className="link mt-1 text-sm" onClick={() => setReveal((r) => !r)}>
            {reveal ? "Hide" : "Decrypt for me"}
          </button>
        </div>
        <Stat label="Loss limit left" value={l ? usd(l.remainingUsd) : "—"} sub={l ? `of ${usd(l.amountUsd, 0)} per ${l.period}` : <Link className="link" href="/onboarding/limit">Set one</Link>} />
        <Stat label="Open bets" value={open.length} sub={`${done.length} settled`} />
      </div>

      <h2 className="mt-12 font-serif text-2xl">Open</h2>
      <div className="mt-4 space-y-3">
        {open.length ? open.map((o) => <Bet key={o.id} o={o} />) : <Empty>No open bets. <Link className="link" href="/markets">Browse markets</Link></Empty>}
      </div>

      <h2 className="mt-12 font-serif text-2xl">Settled</h2>
      <div className="mt-4 space-y-3">{done.length ? done.map((o) => <Bet key={o.id} o={o} />) : <Empty>Nothing settled yet.</Empty>}</div>

      <h2 className="mt-12 font-serif text-2xl">Receipts</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {receipts.data?.receipts?.length ? (
          receipts.data.receipts.map((r) => (
            <Link key={r.id} href={`/receipts/${r.id}`} className="card block px-5 py-4">
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
