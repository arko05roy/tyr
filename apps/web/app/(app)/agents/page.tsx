"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, explorer, ok, usd } from "../../_app/api";
import { authorizeAccessKey } from "../../_app/passkey";
import { demoAgentCalls, demoSessions, orDemo } from "../../_app/demo";
import { Empty, ErrorNote, PageHead, Stat, TxLink } from "../../_app/ui";

const HOW = [
  ["Make a key", "Your browser generates the agent's key. tyr only ever sees its address."],
  ["Cap it with your passkey", "Your passkey authorizes it as a Tempo access key with a spend limit per day or week."],
  ["Agent hits a paid route", "The API answers HTTP 402 with an MPP challenge naming the price."],
  ["It pays and gets served", "The agent pays on Tempo through its key. Past the cap, the chain rejects the payment."],
] as const;

// services/api/src/routes/agent.ts
const ROUTES = [
  ["GET", "/api/agent/me", "Free", "Session, cap and what's left"],
  ["GET", "/api/agent/markets", "Free", "Featured markets with prices"],
  ["GET", "/api/agent/markets/:id/data", "$0.01", "Order book and market data"],
  ["GET", "/api/agent/evidence/:id", "$0.01", "Resolution sources for a market"],
  ["POST", "/api/agent/bets", "the stake", "Place a bet; the payment is the stake"],
  ["GET", "/api/agent/bets/:id", "Free", "Bet status and settlement"],
] as const;

const SNIPPET = `// examples/agent.ts
// 1. free: list markets, pick one
const { markets } = await call("GET", "/api/agent/markets");

// 2. paid: 402 → pays $0.01 on Tempo with the capped key → 200
const data = await call("GET", \`/api/agent/markets/\${m.outcome}/data\`, undefined, pay);

// 3. bet: the 402 charge IS the stake, capped on-chain
const bet = await call("POST", "/api/agent/bets",
  { outcome: m.outcome, side: "yes", stakeUsd: 12, idempotencyKey }, pay);`;

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

  const list = orDemo(sessions.data?.sessions, demoSessions);
  const live = list.filter((s) => s.active);
  const spent = list.reduce((a, s) => a + s.spentUsd, 0);
  const capTotal = live.reduce((a, s) => a + s.capUsd, 0);
  const left = live.reduce((a, s) => a + (s.remainingUsd ?? s.capUsd - s.spentUsd), 0);

  return (
    <div>
      <PageHead eyebrow="Flow C · Agents" title="Give an agent a budget it can't exceed">
        Each agent gets its own key, authorized by your passkey as a Tempo access key with a spend cap. Paid endpoints
        answer HTTP 402 and the agent pays per call over MPP. Past the cap, the payment fails on-chain.
      </PageHead>

      <ol className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HOW.map(([title, body], i) => (
          <li key={title} className="panel px-5 py-4">
            <p className="num font-serif text-3xl text-olive">{i + 1}</p>
            <p className="mt-1 font-medium">{title}</p>
            <p className="mt-1 text-sm text-ink-soft">{body}</p>
          </li>
        ))}
      </ol>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Active agents" value={live.length} sub={`${list.length} session${list.length === 1 ? "" : "s"} in total`} />
        <Stat label="Spent by agents" value={usd(spent)} sub={`across all sessions`} />
        <Stat label="Budget left" value={usd(left)} sub={`of ${usd(capTotal, 0)} in active caps`} />
      </div>

      <h2 className="mb-4 font-serif text-2xl">New agent</h2>
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
        {list.length ? (
          list.map((s) => {
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
                    {s.active && !s.id.startsWith("demo") && (
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

      {list.some((s) => s.id.startsWith("demo")) && (
        <>
          <h2 className="mt-12 font-serif text-2xl">Recent paid calls</h2>
          <ol className="panel mt-4 divide-y divide-rule">
            {demoAgentCalls.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="mono truncate">{c.route}</p>
                  <p className="text-ink-soft">{c.agent} · 402 → paid on Tempo → 200</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="num font-medium">{usd(c.usd)}</p>
                  <p className="num text-ink-soft">{new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <h2 className="font-serif text-2xl">What agents can call</h2>
          <div className="panel mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-soft">
                <tr>
                  <th className="px-5 py-3 font-normal">Route</th>
                  <th className="px-3 py-3 font-normal">Price</th>
                </tr>
              </thead>
              <tbody>
                {ROUTES.map(([method, path, price, what]) => (
                  <tr key={path + method} className="border-t border-rule align-top">
                    <td className="px-5 py-3">
                      <p className="mono">
                        <span className="text-olive">{method}</span> {path}
                      </p>
                      <p className="mt-0.5 text-ink-soft">{what}</p>
                    </td>
                    <td className="num whitespace-nowrap px-3 py-3">{price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2 className="font-serif text-2xl">Run the reference agent</h2>
          <pre className="mono mt-4 overflow-x-auto rounded-2xl bg-charcoal p-5 text-xs leading-relaxed text-cream">{SNIPPET}</pre>
          <p className="mt-3 text-sm text-ink-soft">
            <span className="mono">AGENT_PRIVATE_KEY=… pnpm --filter examples agent</span>
          </p>
        </section>
      </div>
    </div>
  );
}
