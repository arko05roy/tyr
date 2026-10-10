"use client";
import Link from "next/link";
import { useState } from "react";
import { cents } from "../../_app/api";
import { useMarketEvents, useVenues } from "../../_app/hooks";
import { Empty, PageHead } from "../../_app/ui";

const CATS = ["all", "crypto", "macro", "finance", "politics", "sports", "culture"] as const;

export default function MarketsPage() {
  const events = useMarketEvents();
  const venues = useVenues();
  const [cat, setCat] = useState<(typeof CATS)[number]>("all");
  const mode = new Map(venues.data?.venues.map((v) => [v.id, v]) ?? []);
  const list = (events.data?.events ?? []).filter((e) => cat === "all" || e.category === cat);

  return (
    <div>
      <PageHead eyebrow="Markets" title="Every venue, one price list">
        Each question shows every venue that lists it. tyr routes your stake to the best all-in price across
        Hyperliquid, Polymarket, Kalshi and Limitless.
      </PageHead>

      <div className="mb-6 flex flex-wrap gap-2">
        {CATS.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className={`chip border border-charcoal capitalize ${cat === c ? "bg-butter" : "bg-paper"}`}>
            {c}
          </button>
        ))}
      </div>

      {events.isLoading ? (
        <Empty>Loading books from every venue…</Empty>
      ) : !list.length ? (
        <Empty>{events.error ? (events.error as Error).message : "No markets in this category."}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((e) => (
            <Link key={e.eventKey} href={`/markets/${encodeURIComponent(e.eventKey)}`} className="card block p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-serif text-xl leading-snug">{e.title}</p>
                <span className="chip bg-sage shrink-0 capitalize">{e.category}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">Resolves {new Date(e.resolvesAt).toLocaleDateString()}</p>
              <table className="num mt-4 w-full text-sm">
                <thead className="text-left text-ink-soft">
                  <tr>
                    <th className="font-normal">Venue</th>
                    <th className="font-normal">Yes</th>
                    <th className="font-normal">No</th>
                  </tr>
                </thead>
                <tbody>
                  {e.venues.map((v) => (
                    <tr key={v.marketId} className="border-t border-rule">
                      <td className="py-1.5">
                        {mode.get(v.venue)?.name ?? v.venue}
                      </td>
                      <td className={e.bestYesAsk.venue === v.venue ? "font-semibold text-olive" : ""}>{cents(v.yesAsk)}</td>
                      <td className={e.bestNoAsk.venue === v.venue ? "font-semibold text-olive" : ""}>{cents(1 - v.yesBid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {e.venues.length > 1 && e.priceGap > 0 && (
                <p className="mt-3 text-sm text-olive">Venues disagree by {cents(e.priceGap)}; tyr routes to the cheapest.</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
