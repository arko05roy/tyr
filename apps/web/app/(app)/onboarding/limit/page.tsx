"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, explorer, ok, usd } from "../../../_app/api";
import { useLimit } from "../../../_app/hooks";
import { authorizeAccessKey } from "../../../_app/passkey";
import { ErrorNote, PageHead, Stat, TxLink } from "../../../_app/ui";

const PRESETS = [20, 50, 100, 250];

export default function LimitPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const limit = useLimit();
  const [amount, setAmount] = useState(50);
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [phase, setPhase] = useState("");

  const set = useMutation({
    mutationFn: async () => {
      setPhase("Preparing access key…");
      const grant = await ok(api.POST("/api/limits/prepare", { body: { amountUsd: amount, period } }));
      setPhase("Confirm with your passkey…");
      const txHash = await authorizeAccessKey(grant);
      setPhase("Checking it on Tempo…");
      return ok(api.PUT("/api/limits/confirm", { body: { limitId: grant.limitId, txHash } }));
    },
    onSettled: () => setPhase(""),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["limit"] });
      router.push("/fund");
    },
  });

  const current = limit.data?.limit;
  return (
    <div className="max-w-2xl">
      <PageHead eyebrow="Step 1 · Loss limit" title="Set a limit you can't break">
        tyr can only spend through a Tempo access key your passkey signs. The chain rejects any stake past
        this amount, whether tyr, an agent, or you places the bet.
      </PageHead>

      {current && (
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          <Stat label={`Current · per ${current.period}`} value={usd(current.amountUsd, 0)} sub={`${usd(current.remainingUsd)} left this period`} />
          {current.authorizedTx && (
            <div className="panel flex items-center px-5 py-4">
              <TxLink href={explorer.tempo(current.authorizedTx)} label="Authorization on Tempo" />
            </div>
          )}
        </div>
      )}

      <div className="panel p-6">
        <div className="flex gap-2">
          {(["day", "week"] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} className={`chip border border-charcoal ${period === p ? "bg-butter" : ""}`}>
              Per {p}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {PRESETS.map((v) => (
            <button key={v} type="button" onClick={() => setAmount(v)} className={`chip num border border-charcoal ${amount === v ? "bg-sage" : ""}`}>
              ${v}
            </button>
          ))}
        </div>
        <label className="mt-5 block text-sm text-ink-soft">
          Amount (USD)
          <input className="field mt-1" type="number" min={1} max={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <button type="button" className="btn btn-primary mt-6" disabled={set.isPending || !(amount > 0)} onClick={() => set.mutate()}>
          {set.isPending ? phase : current ? `Replace with ${usd(amount, 0)} / ${period}` : `Set ${usd(amount, 0)} / ${period}`}
        </button>
        <ErrorNote error={set.error} />
      </div>
    </div>
  );
}
