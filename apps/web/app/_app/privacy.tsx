"use client";
import { useState } from "react";

// idea §6 honesty requirement: say plainly what is hidden, from whom, and what is not.
const ROWS: [string, string, string][] = [
  ["Bankroll", "Hidden", "Token-2022 confidential balance on Solana devnet. tyr derives your keys server-side (custodial, disclosed), and the auditor key can decrypt transfer amounts, not your balance."],
  ["Bet size on Solana", "Hidden", "Position PDAs store a salted commitment, not the stake."],
  ["Order on the venue", "Public", "The venue sees tyr's pooled float trade, not you. Hyperliquid fills are paper fills against the live testnet book."],
  ["Zcash entry", "Hidden", "Shielded memo-as-order. tyr's viewing key reads it (local regtest)."],
  ["Loss limit & payouts", "Public", "Tempo txs and memos are public on Moderato. The memo is a hash, not your bet."],
  ["Who you are", "Hidden", "Passkey only: no email, no name, no seed phrase."],
];

export function PrivacyPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)]">
      {open && (
        <div className="panel mb-3 w-[26rem] max-w-full p-5 shadow-[0_18px_40px_-20px_#4c6b46]">
          <p className="font-serif text-xl">What&apos;s private here</p>
          <ul className="mt-3 space-y-3 text-sm">
            {ROWS.map(([k, v, why]) => (
              <li key={k}>
                <p className="flex items-center justify-between gap-2 font-medium">
                  {k}
                  <span className={`chip !py-0 !text-[0.7rem] ${v === "Hidden" ? "bg-sage" : "bg-butter"}`}>{v}</span>
                </p>
                <p className="text-ink-soft">{why}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-rule pt-3 text-xs text-ink-soft">
            Everything runs on testnets. Polymarket, Kalshi and Limitless prices are simulated.
          </p>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn btn-secondary btn-sm ml-auto flex" aria-expanded={open}>
        {open ? "Close" : "What's private here?"}
      </button>
    </div>
  );
}
