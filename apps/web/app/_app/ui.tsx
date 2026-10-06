"use client";
import type { ReactNode } from "react";

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8">
      <p className="eyebrow text-olive">{eyebrow}</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-ink-soft">{children}</div>}
    </header>
  );
}

export function SimBadge({ live = false }: { live?: boolean }) {
  return live ? (
    <span className="chip bg-sage !px-2 !py-0.5 !text-[0.7rem]">live testnet</span>
  ) : (
    <span className="chip border border-dashed border-ink-soft !px-2 !py-0.5 !text-[0.7rem] text-ink-soft">
      simulated
    </span>
  );
}

export function TxLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="link text-sm">
      {label} ↗
    </a>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 rounded-xl bg-[var(--alert)] px-4 py-3 text-sm">
      {(error as Error).message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="panel px-6 py-10 text-center text-ink-soft">{children}</p>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="panel px-5 py-4">
      <p className="eyebrow !text-[0.65rem] text-ink-soft">{label}</p>
      <p className="num mt-1 font-serif text-3xl">{value}</p>
      {sub && <p className="mt-1 text-sm text-ink-soft">{sub}</p>}
    </div>
  );
}
