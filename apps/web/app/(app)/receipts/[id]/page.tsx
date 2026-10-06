"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use } from "react";
import { api, ok } from "../../../_app/api";
import { useMe } from "../../../_app/hooks";
import { Empty, ErrorNote, PageHead, TxLink } from "../../../_app/ui";

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const me = useMe();
  const path = { params: { path: { id } } };
  const receipt = useQuery({ queryKey: ["receipt", id], queryFn: () => ok(api.GET("/api/receipts/{id}", path)), retry: false });
  const verify = useQuery({ queryKey: ["verify", id], queryFn: () => ok(api.GET("/api/receipts/{id}/verify", path)), enabled: receipt.isSuccess });
  const proof = useQuery({ queryKey: ["proof", id], queryFn: () => ok(api.GET("/api/receipts/{id}/proof", path)), enabled: receipt.isSuccess });
  const vis = useMutation({
    mutationFn: (visibility: "public" | "private") => ok(api.PUT("/api/receipts/{id}/visibility", { ...path, body: { visibility } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipt", id] }),
  });

  if (!receipt.data)
    return <Empty>{receipt.isLoading ? "Loading receipt…" : "This receipt is private or doesn't exist."}</Empty>;
  const r = receipt.data;
  const p = proof.data;
  const owner = !!me.data; // non-owners only ever get public receipts
  return (
    <div className="max-w-3xl">
      <PageHead eyebrow={`${r.kind} receipt`} title={verify.data ? (verify.data.ok ? "Verified on-chain" : "Verification failed") : "Verifying against the chains…"}>
        These checks read Tempo, Solana and Zcash directly, not tyr&apos;s database.
      </PageHead>

      {owner && (
        <div className="panel mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
          <p>
            This receipt is <b>{r.visibility}</b>.{" "}
            {r.visibility === "public" ? "Anyone with the link can verify it." : "Only you can see it."}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" disabled={vis.isPending} onClick={() => vis.mutate(r.visibility === "public" ? "private" : "public")}>
            {r.visibility === "public" ? "Keep private" : "Prove it publicly"}
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {verify.data?.checks.map((c) => (
          <li key={c.name} className="panel flex items-start gap-3 px-5 py-3">
            <span className={`chip !px-2 ${c.ok ? "bg-sage" : "bg-[var(--alert)]"}`}>{c.ok ? "✓" : "✗"}</span>
            <div>
              <p>{c.name}</p>
              {c.detail && <p className="mono text-ink-soft">{c.detail}</p>}
            </div>
          </li>
        ))}
      </ul>

      {p && (
        <div className="mt-8">
          <h2 className="font-serif text-2xl">On the explorers</h2>
          <div className="mt-3 flex flex-col gap-2">
            {p.tempo.map((t) => (
              <TxLink key={t.tx} href={t.explorer} label={`Tempo · ${t.label}`} />
            ))}
            {p.solana?.attestations.map((a) => (
              <TxLink key={a.tx} href={a.explorer} label={`Solana · ${a.label}`} />
            ))}
          </div>
          <p className="mono mt-6 text-ink-soft">payload hash {r.payloadHash}</p>
        </div>
      )}
      <ErrorNote error={verify.error ?? vis.error} />
    </div>
  );
}
