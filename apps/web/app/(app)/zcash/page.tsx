"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { api, cents, ok, usd } from "../../_app/api";
import { ErrorNote, PageHead } from "../../_app/ui";

export default function ZcashPage() {
  // The memo codec (v1) encodes a Hyperliquid outcome id, so Flow B lists HL markets only.
  const markets = useQuery({ queryKey: ["hl-markets"], queryFn: () => ok(api.GET("/api/markets")) });
  const [outcome, setOutcome] = useState<number | null>(null);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [stake, setStake] = useState(15);
  const [returnUA, setUA] = useState("");
  const [txid, setTxid] = useState("");
  const list = (markets.data as { markets?: { outcome: number; name: string; yes: { ask: number } }[] } | undefined)?.markets ?? [];
  const chosen = outcome ?? list[0]?.outcome ?? null;

  const req = useMutation({
    mutationFn: () => ok(api.POST("/api/zcash/request", { body: { outcome: chosen!, side, stakeUsd: stake, returnUA } })),
  });
  const order = useQuery({
    queryKey: ["zcash-order", txid],
    queryFn: () => ok(api.GET("/api/zcash/orders/{txid}", { params: { path: { txid } } })),
    enabled: txid.length > 10,
    refetchInterval: 10_000,
    retry: false,
  });

  return (
    <div className="max-w-3xl">
      <PageHead eyebrow="Flow B · Shielded entry" title="Bet by sending shielded Zcash">
        The memo on your shielded payment is the order. No account needed: tyr&apos;s viewing key reads the memo, places
        the bet, and pays out in shielded ZEC to your return address, authorized by a 2-of-3 FROST quorum. Runs on a
        local Zcash regtest.
      </PageHead>

      <div className="panel space-y-4 p-6">
        <label className="block text-sm text-ink-soft">
          Market (Hyperliquid)
          <select className="field mt-1" value={chosen ?? ""} onChange={(e) => setOutcome(Number(e.target.value))}>
            {list.map((m) => (
              <option key={m.outcome} value={m.outcome}>
                {m.name} · yes {cents(m.yes.ask)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          {(["yes", "no"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)} className={`chip border border-charcoal uppercase ${side === s ? "bg-butter" : ""}`}>
              {s}
            </button>
          ))}
        </div>
        <label className="block text-sm text-ink-soft">
          Stake (USD)
          <input className="field mt-1" type="number" min={10} value={stake} onChange={(e) => setStake(Number(e.target.value))} />
        </label>
        <label className="block text-sm text-ink-soft">
          Your shielded return address (unified address)
          <input className="field mono mt-1" placeholder="uregtest1…" value={returnUA} onChange={(e) => setUA(e.target.value.trim())} />
        </label>
        <button type="button" className="btn btn-primary" disabled={chosen === null || !returnUA || req.isPending} onClick={() => req.mutate()}>
          Get payment request
        </button>
        <ErrorNote error={req.error} />
      </div>

      {req.data && (
        <div className="panel mt-6 flex flex-col gap-6 p-6 sm:flex-row">
          <div className="rounded-xl bg-cream p-3">
            <QRCodeSVG value={req.data.uri} size={180} bgColor="transparent" fgColor="#2b2b2b" />
          </div>
          <div className="min-w-0">
            <p className="font-serif text-xl">Send {(Number(req.data.zat) / 1e8).toFixed(6)} ZEC</p>
            <p className="text-sm text-ink-soft">at {usd(req.data.zecUsd)}/ZEC, including a 2% rate buffer; any excess comes back with your payout.</p>
            <p className="mono mt-3">{req.data.uri}</p>
            <p className="mt-4 flex items-center gap-2 text-sm">
              <span className="breathe inline-block h-2 w-2 rounded-full bg-olive" /> Waiting for your shielded payment…
            </p>
          </div>
        </div>
      )}

      <div className="panel mt-6 p-6">
        <p className="font-serif text-lg">Track a payment</p>
        <input className="field mono mt-2" placeholder="your Zcash txid" value={txid} onChange={(e) => setTxid(e.target.value.trim())} />
        {order.data && (
          <div className="mt-4 text-sm">
            <p>
              Status: <b>{order.data.status}</b> · {order.data.side.toUpperCase()} {usd(order.data.size)}
            </p>
            {order.data.payoutTxid && <p className="mono mt-1">payout {order.data.payoutTxid}</p>}
            {order.data.error && <p className="text-ink-soft">{order.data.error}</p>}
          </div>
        )}
        {txid.length > 10 && order.isError && <p className="mt-3 text-sm text-ink-soft">Not seen yet. The scanner checks every block.</p>}
      </div>
    </div>
  );
}
