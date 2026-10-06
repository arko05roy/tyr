"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, explorer, ok, usd } from "../../_app/api";
import { authorizeAccessKey } from "../../_app/passkey";
import { Empty, ErrorNote, PageHead, TxLink } from "../../_app/ui";

export default function AgentsPage() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["agent-sessions"], queryFn: () => ok(api.GET("/api/agent/sessions")), refetchInterval: 15_000 });
  const [name, setName] = useState("my-agent");
  const [cap, setCap] = useState(20);
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [phase, setPhase] = useState("");
  const [secret, setSecret] = useState<{ key: string; address: string } | null>(null);

  // The agent's key is made here and shown once; tyr only ever learns its address.
  const create = useMutation({
    mutationFn: async () => {
      const key = generatePrivateKey();
      const agentAddress = privateKeyToAccount(key).address;
      setPhase("Creating session…");
      const grant = await ok(api.POST("/api/agent/sessions", { body: { agentAddress, capUsd: cap, period, name } }));
      setPhase("Confirm the cap with your passkey…");
      const txHash = await authorizeAccessKey(grant);
      setPhase("Checking it on Tempo…");
      await ok(api.PUT("/api/agent/sessions/{id}/confirm", { params: { path: { id: grant.sessionId } }, body: { txHash } }));
      return { key, address: agentAddress };
    },
    onSuccess: (s) => {
      setSecret(s);
      qc.invalidateQueries({ queryKey: ["agent-sessions"] });
    },
    onSettled: () => setPhase(""),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => ok(api.DELETE("/api/agent/sessions/{id}", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-sessions"] }),
  });

  return (
    <div>
      <PageHead eyebrow="Flow C · Agents" title="Give an agent a budget it can't exceed">
        Each agent gets its own key, authorized by your passkey as a Tempo access key with a spend cap. Paid endpoints
        answer HTTP 402 and the agent pays per call over MPP. Past the cap, the payment fails on-chain.
      </PageHead>

      <div className="panel grid gap-4 p-6 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
        <label className="text-sm text-ink-soft">
          Name
          <input className="field mt-1" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm text-ink-soft">
          Cap (USD)
          <input className="field mt-1" type="number" min={1} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </label>
        <label className="text-sm text-ink-soft">
          Per
          <select className="field mt-1" value={period} onChange={(e) => setPeriod(e.target.value as "day" | "week")}>
            <option value="day">day</option>
            <option value="week">week</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={create.isPending || !(cap > 0)} onClick={() => create.mutate()}>
          {create.isPending ? phase : "Create session"}
        </button>
      </div>
      <ErrorNote error={create.error ?? revoke.error} />

      {secret && (
        <div className="panel mt-6 border-butter-deep bg-butter/30 p-6">
          <p className="font-serif text-xl">Agent key: copy it now, it won&apos;t be shown again</p>
          <p className="mono mt-3">AGENT_PRIVATE_KEY={secret.key}</p>
          <p className="mt-3 text-sm text-ink-soft">
            Address {secret.address}. Run the reference agent: <span className="mono">AGENT_PRIVATE_KEY=… pnpm tsx examples/agent.ts</span>
          </p>
          <button type="button" className="link mt-3 text-sm" onClick={() => setSecret(null)}>
            I&apos;ve saved it
          </button>
        </div>
      )}

      <h2 className="mt-12 font-serif text-2xl">Sessions</h2>
      <div className="mt-4 space-y-3">
        {sessions.data?.sessions.length ? (
          sessions.data.sessions.map((s) => {
            const pct = Math.min(100, (s.spentUsd / s.capUsd) * 100);
            return (
              <div key={s.id} className="panel px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {s.name ?? "agent"} <span className="mono text-ink-soft">{s.agentAddress.slice(0, 10)}…</span>
                    </p>
                    <p className="num text-sm text-ink-soft">
                      {usd(s.spentUsd)} spent of {usd(s.capUsd, 0)} / {s.period}
                      {s.remainingUsd !== null && ` · ${usd(s.remainingUsd)} left on-chain`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {s.authorizedTx && <TxLink href={explorer.tempo(s.authorizedTx)} label="Cap on Tempo" />}
                    <span className={`chip ${s.active ? "bg-sage" : "bg-[var(--alert)]"}`}>{s.revokedAt ? "revoked" : s.active ? "active" : "pending"}</span>
                    {s.active && (
                      <button type="button" className="chip border border-charcoal" onClick={() => revoke.mutate(s.id)}>
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream">
                  <div className="h-full bg-olive transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })
        ) : (
          <Empty>No agent sessions yet.</Empty>
        )}
      </div>
    </div>
  );
}
