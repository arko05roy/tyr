"use client";
// 1inch-style route view: stake on the left, contracts on the right, one branch per venue leg
// sized by its share of the fill, plus a comparison against buying everything on a single venue.
import { cents, usd } from "./api";

type Leg = { venue: string; marketId: string; sz: number; avgPx: number; costUsd: number; feeUsd: number };
type Single = { venue: string; marketId: string; contracts: number; costUsd: number };
export type RouteQuote = {
  side: "yes" | "no";
  stakeUsd: number;
  legs: Leg[];
  contracts: number;
  costUsd: number;
  avgAllInPx: number;
  singles: Single[];
};

const ROW = 52;

export function RouteMap({ q, names, stale }: { q: RouteQuote; names: (venue: string) => string; stale?: boolean }) {
  const { legs } = q;
  const h = Math.max(1, legs.length) * ROW;
  const mid = h / 2;
  const best = q.singles[0];
  const vsBest = best ? q.contracts - best.contracts : 0;
  const fees = legs.reduce((s, l) => s + l.feeUsd, 0);

  return (
    <div className={`panel p-5 transition-opacity ${stale ? "opacity-70" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl">Best route</h2>
        <p className="text-xs text-ink-soft">
          {legs.length} venue{legs.length === 1 ? "" : "s"} · requotes every 15s
        </p>
      </div>

      {legs.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          No split clears every venue&apos;s minimum order for {usd(q.stakeUsd, 0)} right now. Try a larger stake.
        </p>
      ) : (
        <>
          <div className="mt-5 space-y-2 sm:hidden">
            <Node label="You pay" value={usd(q.costUsd)} sub="from hidden balance" />
            {legs.map((l) => (
              <div key={l.marketId} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate font-medium">{names(l.venue)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-cream">
                  <span className="block h-full bg-olive/60" style={{ width: `${(l.sz / q.contracts) * 100}%` }} />
                </span>
                <span className="num w-10 text-right">{Math.round((l.sz / q.contracts) * 100)}%</span>
              </div>
            ))}
            <Node label="You get" value={q.contracts.toFixed(1)} sub={`${q.side.toUpperCase()} contracts`} />
          </div>
          <div className="mt-5 hidden grid-cols-[auto_1fr_auto] items-center gap-2 sm:grid">
            <Node label="You pay" value={usd(q.costUsd)} sub="from hidden balance" />
            <div className="relative" style={{ height: h }}>
              <svg
                aria-hidden
                className="absolute inset-0 h-full w-full overflow-visible"
                preserveAspectRatio="none"
                viewBox={`0 0 100 ${h}`}
              >
                {legs.map((l, i) => {
                  const y = i * ROW + ROW / 2;
                  return (
                    <g
                      key={l.marketId}
                      fill="none"
                      stroke="var(--olive)"
                      strokeOpacity={0.55}
                      strokeWidth={1.5 + (l.sz / q.contracts) * 5}
                      strokeLinecap="round"
                    >
                      <path d={`M0 ${mid} C 14 ${mid}, 10 ${y}, 22 ${y}`} vectorEffect="non-scaling-stroke" />
                      <path d={`M78 ${y} C 90 ${y}, 86 ${mid}, 100 ${mid}`} vectorEffect="non-scaling-stroke" />
                    </g>
                  );
                })}
              </svg>
              {legs.map((l, i) => (
                <div
                  key={l.marketId}
                  className="absolute left-[22%] right-[22%] flex items-center justify-between gap-2 rounded-full border-[1.5px] border-charcoal bg-paper py-1 pl-3 pr-1 text-xs"
                  style={{ top: i * ROW + ROW / 2, transform: "translateY(-50%)" }}
                  title={`${l.sz.toFixed(1)} contracts @ ${cents(l.avgPx)} + ${usd(l.feeUsd)} fee`}
                >
                  <span className="truncate font-medium">{names(l.venue)}</span>
                  <span className="num shrink-0 rounded-full bg-sage px-2 py-0.5">
                    {Math.round((l.sz / q.contracts) * 100)}%
                  </span>
                </div>
              ))}
            </div>
            <Node label="You get" value={q.contracts.toFixed(1)} sub={`${q.side.toUpperCase()} contracts`} />
          </div>

          <ul className="mt-4 space-y-1 text-xs text-ink-soft">
            {legs.map((l) => (
              <li key={l.marketId} className="num flex justify-between">
                <span>
                  {names(l.venue)} · {l.sz.toFixed(1)} @ {cents(l.avgPx)}
                </span>
                <span>
                  {usd(l.costUsd)} incl. {usd(l.feeUsd)} fee
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-rule pt-4 text-sm">
            <div>
              <dt className="text-xs text-ink-soft">Avg price</dt>
              <dd className="num">{cents(q.avgAllInPx)} all-in</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-soft">Pays if right</dt>
              <dd className="num">{usd(q.contracts)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-soft">Venue fees</dt>
              <dd className="num">{usd(fees)}</dd>
            </div>
          </dl>
        </>
      )}

      {q.singles.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow !text-[0.65rem] text-ink-soft">Vs. one venue for the same stake</p>
          <table className="num mt-2 w-full text-sm">
            <tbody>
              {legs.length > 0 && (
                <tr className="border-t border-rule bg-sage/60">
                  <td className="py-2 pl-3 font-medium">tyr route</td>
                  <td className="text-right">{q.contracts.toFixed(1)}</td>
                  <td className="pr-3 text-right text-olive">
                    {vsBest > 0 ? `+${vsBest.toFixed(1)} vs best` : "best"}
                  </td>
                </tr>
              )}
              {q.singles.map((s) => {
                const diff = s.contracts - q.contracts;
                return (
                  <tr key={s.marketId} className="border-t border-rule">
                    <td className="py-2 pl-3">{names(s.venue)} only</td>
                    <td className="text-right">{s.contracts ? s.contracts.toFixed(1) : "—"}</td>
                    <td className="pr-3 text-right text-ink-soft">
                      {!s.contracts ? "can't fill" : !legs.length ? "" : diff === 0 ? "same" : diff.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Node({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border-[1.5px] border-charcoal bg-butter px-3 py-2 text-center">
      <p className="text-[0.65rem] uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="num font-serif text-xl">{value}</p>
      <p className="text-[0.65rem] text-ink-soft">{sub}</p>
    </div>
  );
}
