"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { api, cents, ok, usd } from "../../_app/api";
import { DEMO, demoZcashOrders } from "../../_app/demo";
import { ErrorNote, PageHead } from "../../_app/ui";

const STEPS = [
  ["Ask for a payment request", "Pick a market, a side and a stake. tyr returns a ZIP-321 URI with the order packed into the memo."],
  ["Send shielded ZEC", "Pay from any Orchard wallet. On-chain, the amount, sender and memo are all encrypted."],
  ["tyr reads the memo", "tyr's viewing key decrypts the note, decodes the order and places the bet with its float."],
  ["Get paid shielded", "On settlement, a 2-of-3 FROST quorum signs a shielded payout to your return address."],
] as const;

// tyr1: memo layout (packages/zcash/src/memo.ts).
const MEMO_FIELDS = [
  ["version", "1 B", "bg-sage"],
  ["outcome", "4 B", "bg-butter"],
  ["side", "1 B", "bg-butter"],
  ["size ¢", "4 B", "bg-butter"],
  ["return UA", "≤ 470 B", "bg-moss/40"],
  ["nonce", "8 B", "bg-cream"],
  ["checksum", "4 B", "bg-cream"],
] as const;

const LIFECYCLE = ["received", "placed", "settled", "paid"] as const;

const SEES = [
  ["Zcash chain", "Nothing: amount, sender and memo are shielded"],
  ["tyr", "The order and your return address, via its viewing key"],
  ["The venue", "A trade from tyr's pooled float, not from you"],
  ["Anyone else", "That a shielded transaction happened"],
] as const;

function Quorum({ signers }: { signers?: string }) {
  const signed = new Set((signers ?? "").split(",").filter(Boolean).map(Number));
  return (
    <div className="flex gap-3">
      {[1, 2, 3].map((n) => (
        <div key={n} className={`flex-1 rounded-xl border px-3 py-3 text-center ${signed.has(n) ? "border-olive bg-sage" : "border-rule bg-cream"}`}>
          <p className="font-serif text-lg">Signer {n}</p>
          <p className="text-xs text-ink-soft">{signed.has(n) ? "signed" : signers ? "not needed" : "standing by"}</p>
        </div>
      ))}
    </div>
  );
}

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
    <div>
      <PageHead eyebrow="Flow B · Shielded entry" title="Bet by sending shielded Zcash">
        The memo on your shielded payment is the order. No account needed: tyr&apos;s viewing key reads the memo, places
        the bet, and pays out in shielded ZEC to your return address, authorized by a 2-of-3 FROST quorum.
      </PageHead>

      <ol className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="panel px-5 py-4">
            <p className="num font-serif text-3xl text-olive">{i + 1}</p>
            <p className="mt-1 font-medium">{title}</p>
            <p className="mt-1 text-sm text-ink-soft">{body}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
      <div>

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

      {DEMO && (
        <div className="panel mt-6 p-6">
          <p className="font-serif text-lg">Your shielded orders</p>
          <ul className="mt-3 divide-y divide-rule text-sm">
            {demoZcashOrders.map((z) => (
              <li key={z.txid} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className={z.side === "yes" ? "text-olive" : ""}>{z.side.toUpperCase()}</span> · {usd(z.usd)} on {z.market}
                  </p>
                  <p className="mono text-ink-soft">
                    {z.zec} ZEC · tx {z.txid}…{z.signers && ` · signed by ${z.signers.replace(",", " + ")}`}
                  </p>
                </div>
                <span className={`chip capitalize ${z.status === "paid" ? "bg-sage" : "bg-butter"}`}>{z.status}</span>
              </li>
            ))}
          </ul>
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

      <aside className="space-y-6">
        <div className="panel p-6">
          <p className="font-serif text-lg">Inside the memo</p>
          <p className="mt-1 text-sm text-ink-soft">
            Sent as <span className="mono">tyr1:</span> + base64url, inside Zcash&apos;s 512-byte encrypted memo field.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {MEMO_FIELDS.map(([name, size, bg]) => (
              <div key={name} className={`rounded-lg px-2.5 py-1.5 text-xs ${bg}`}>
                <p className="font-medium">{name}</p>
                <p className="num text-ink-soft">{size}</p>
              </div>
            ))}
          </div>
          {req.data && <p className="mono mt-4 break-all text-xs text-ink-soft">{decodeURIComponent(req.data.uri.split("memo=")[1] ?? "")}</p>}
        </div>

        <div className="panel p-6">
          <p className="font-serif text-lg">Payout quorum</p>
          <p className="mt-1 text-sm text-ink-soft">No single key can move funds. Any 2 of 3 FROST signers authorize each payout.</p>
          <div className="mt-4">
            <Quorum signers={(order.data as { frostSigners?: string } | undefined)?.frostSigners ?? (DEMO ? demoZcashOrders[1]!.signers : undefined)} />
          </div>
        </div>

        <div className="panel p-6">
          <p className="font-serif text-lg">Order status</p>
          <ol className="mt-4 space-y-2">
            {LIFECYCLE.map((st, i) => {
              const at = LIFECYCLE.indexOf((order.data?.status ?? (DEMO ? demoZcashOrders[0]!.status : "")) as (typeof LIFECYCLE)[number]);
              const reached = at >= i;
              return (
                <li key={st} className="flex items-center gap-3 text-sm">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${reached ? "bg-olive" : "border border-ink-soft"}`} />
                  <span className={`capitalize ${reached ? "font-medium" : "text-ink-soft"}`}>{st}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-ink-soft">Paste a txid under “Track a payment” to follow it live.</p>
        </div>

        <div className="panel p-6">
          <p className="font-serif text-lg">Who sees what</p>
          <ul className="mt-3 space-y-3 text-sm">
            {SEES.map(([who, what]) => (
              <li key={who}>
                <p className="font-medium">{who}</p>
                <p className="text-ink-soft">{what}</p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      </div>
    </div>
  );
}
