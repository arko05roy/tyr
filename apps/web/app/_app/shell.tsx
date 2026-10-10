"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { usd } from "./api";
import { useBalance, useLimit, useMe } from "./hooks";
import { DEMO, demoBalanceUsd } from "./demo";
import { PrivacyPanel } from "./privacy";
import { DASHBOARD_URL, isDashboard } from "./surface";

const NAV: readonly (readonly [string, string])[] = isDashboard
  ? [
      ["/portfolio", "Portfolio"],
      ["/markets", "Markets"],
      ["/zcash", "Zcash"],
      ["/agents", "Agents"],
    ]
  : [
      ["/onboarding/limit", "Loss limit"],
      ["/fund", "Deposit"],
    ];

// Browsable without a session; everything else needs one.
const PUBLIC = [/^\/start/, /^\/markets/, /^\/receipts\//];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const me = useMe();
  const signedIn = !!me.data;
  const limit = useLimit(signedIn);
  const balance = useBalance(signedIn);
  const isPublic = PUBLIC.some((r) => r.test(path));

  useEffect(() => {
    if (me.isSuccess && !me.data && !isPublic) router.replace(`/start?next=${encodeURIComponent(path)}`);
  }, [me.isSuccess, me.data, isPublic, path, router]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-rule bg-cream/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href={isDashboard ? "/portfolio" : "/"} className="font-serif text-2xl font-semibold tracking-tight">
            TYR
          </Link>
          <div className="flex flex-1 gap-4 overflow-x-auto font-serif text-[0.95rem]">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`whitespace-nowrap border-b-[1.5px] py-1 ${path.startsWith(href) ? "border-charcoal" : "border-transparent text-ink-soft hover:text-charcoal"}`}
              >
                {label}
              </Link>
            ))}
          </div>
          {signedIn ? (
            <div className="hidden items-center gap-3 text-sm sm:flex">
              <span className="num" title="Confidential balance (decrypted for you only)">
                {usd(balance.data?.availableUsd || (DEMO ? demoBalanceUsd : balance.data?.availableUsd))}
              </span>
              {!isDashboard && (
                <a href={`${DASHBOARD_URL}/portfolio`} className="btn btn-primary btn-sm">
                  Open dashboard →
                </a>
              )}
              <Link href="/onboarding/limit" className="chip bg-sage num" title="Remaining loss limit (enforced on Tempo)">
                {limit.data?.limit ? `${usd(limit.data.limit.remainingUsd, 0)} left` : "Set limit"}
              </Link>
            </div>
          ) : (
            <Link href={`/start?next=${encodeURIComponent(path)}`} className="btn btn-primary btn-sm">
              Sign in
            </Link>
          )}
        </nav>
      </header>
      <p className="bg-charcoal py-1 text-center text-xs tracking-wide text-cream">
        TESTNET ONLY · Tempo Moderato · Solana devnet · Hyperliquid testnet · no real money
      </p>
      <main className="mx-auto max-w-6xl px-4 py-10 pb-28">{children}</main>
      <PrivacyPanel />
    </div>
  );
}
