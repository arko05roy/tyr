"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { api, explorer, ok, usd } from "../../_app/api";
import { useBalance } from "../../_app/hooks";
import { useEvents } from "../../_app/providers";
import { Empty, ErrorNote, PageHead, Stat, TxLink } from "../../_app/ui";

type Tab = "solana" | "tempo" | "evm";
const TABS: [Tab, string, string][] = [
  ["solana", "Solana devnet", "USDC"],
  ["tempo", "Tempo Moderato", "AlphaUSD"],
  ["evm", "Sepolia · Base · Arbitrum · Robinhood", "USDC / ETH"],
];
const STATUS: Record<string, string> = {
  confirmed: "Seen on source chain",
  minted: "tyrUSD minted",
  credited: "In your hidden balance",
};

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="chip border border-charcoal"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Address({ label, value, qr = true }: { label: string; value: string; qr?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {qr && (
        <div className="rounded-xl bg-cream p-3">
          <QRCodeSVG value={value} size={128} bgColor="transparent" fgColor="#2b2b2b" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-soft">{label}</p>
        <p className="mono mt-1">{value}</p>
        <div className="mt-2">
          <Copy value={value} />
        </div>
      </div>
    </div>
  );
}

function Claim({ chains }: { chains: string[] }) {
  const qc = useQueryClient();
  const [chain, setChain] = useState(chains[0] ?? "");
  const [txHash, setTx] = useState("");
  const claim = useMutation({
    mutationFn: () => ok(api.POST("/api/deposits/claim", { body: { chain, txHash } as never })),
    onSuccess: () => {
      setTx("");
      qc.invalidateQueries({ queryKey: ["deposits"] });
    },
  });
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <p className="font-serif text-lg">Sent ETH? Claim it by tx hash</p>
      <p className="text-sm text-ink-soft">ETH is priced with Chainlink when credited; USDC is detected automatically.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select className="field sm:w-48" value={chain} onChange={(e) => setChain(e.target.value)}>
          {chains.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input className="field mono" placeholder="0x…" value={txHash} onChange={(e) => setTx(e.target.value.trim())} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!/^0x[0-9a-fA-F]{64}$/.test(txHash) || claim.isPending} onClick={() => claim.mutate()}>
          Claim
        </button>
      </div>
      <ErrorNote error={claim.error} />
    </div>
  );
}

export default function FundPage() {
  const [tab, setTab] = useState<Tab>("solana");
  const balance = useBalance();
  const live = useEvents().filter((e) => e.type === "deposit");
  const addrs = useQuery({ queryKey: ["deposit-addresses"], queryFn: () => ok(api.GET("/api/deposits/addresses")), staleTime: Infinity });
  const deposits = useQuery({ queryKey: ["deposits"], queryFn: () => ok(api.GET("/api/deposits")), refetchInterval: 20_000 });
  const a = addrs.data;

  return (
    <div>
      <PageHead eyebrow="Step 2 · Fund" title="Fund it from any chain">
        Deposits are credited as tyrUSD into a confidential balance on Solana. The amount is encrypted on-chain;
        only you can see it here. Cross-chain hops run through tyr&apos;s own relayer on testnet.
      </PageHead>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Hidden balance" value={usd(balance.data?.availableUsd)} sub="tyrUSD · Solana devnet" />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, name, asset]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`chip border border-charcoal ${tab === id ? "bg-butter" : "bg-paper"}`}>
            {name} <span className="text-ink-soft">· {asset}</span>
          </button>
        ))}
      </div>

      <div className="panel mt-4 p-6">
        {!a ? (
          <p className="text-ink-soft">{addrs.error ? (addrs.error as Error).message : "Loading addresses…"}</p>
        ) : tab === "solana" ? (
          <>
            <Address label="Send devnet USDC to this token account" value={a.solana.usdcAta} />
            <p className="mt-4 text-sm text-ink-soft">
              USDC mint <span className="mono">{a.solana.usdcMint}</span> · owner{" "}
              <a className="link" href={explorer.solanaAccount(a.solana.owner)} target="_blank" rel="noreferrer">
                {a.solana.owner.slice(0, 6)}…
              </a>
            </p>
          </>
        ) : tab === "tempo" ? (
          <>
            <Address label="Send AlphaUSD with transferWithMemo to" value={a.tempo.to} />
            <div className="mt-4">
              <p className="text-sm text-ink-soft">Memo (identifies you, required)</p>
              <p className="mono">{a.tempo.memo}</p>
              <div className="mt-2">
                <Copy value={a.tempo.memo} />
              </div>
            </div>
          </>
        ) : (
          <>
            <Address label={`Your deposit address on ${a.evm.chains.join(", ")}`} value={a.evm.address} />
            <ul className="mt-4 text-sm text-ink-soft">
              {Object.entries(a.evm.assets).map(([chain, assets]) => (
                <li key={chain}>
                  {chain}: {assets.join(", ")}
                </li>
              ))}
            </ul>
            <Claim chains={a.evm.chains} />
          </>
        )}
      </div>

      <h2 className="mt-12 font-serif text-2xl">Deposits</h2>
      {live[0] && (
        <p className="mt-2 text-sm text-olive">
          Live: {live[0].sourceChain} deposit {STATUS[live[0].status] ?? live[0].status} ({usd(live[0].amountUsd)})
        </p>
      )}
      <div className="mt-4 space-y-3">
        {deposits.data?.deposits.length ? (
          deposits.data.deposits.map((d) => (
            <div key={d.id} className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-medium">
                  {usd(d.amount)} <span className="text-ink-soft">from {d.sourceChain} · {d.asset}</span>
                </p>
                <p className="text-sm text-ink-soft">{new Date(d.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`chip ${d.status === "credited" ? "bg-sage" : "bg-butter"}`}>{STATUS[d.status] ?? d.status}</span>
                {d.solanaTx && <TxLink href={explorer.solana(d.solanaTx)} label="Solana" />}
              </div>
            </div>
          ))
        ) : (
          <Empty>No deposits yet. They show up here within a few blocks.</Empty>
        )}
      </div>
    </div>
  );
}
