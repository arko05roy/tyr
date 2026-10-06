"use client";
// All data comes from the tyr API (PRD 12 rule): same-origin via the /api rewrite.
import { createTyrClient, type ApiError } from "@tyr/api-client";

export const api = createTyrClient({ baseUrl: "" });

/** Unwrap an openapi-fetch result, throwing the API's `{ error, code }` as an Error. */
export async function ok<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || data === undefined) {
    const e = (error ?? {}) as Partial<ApiError>;
    throw Object.assign(new Error(e.error ?? `HTTP ${response.status}`), {
      status: response.status,
      code: e.code,
    });
  }
  return data;
}

/** The event stream lives on the API host directly (Next rewrites don't proxy WebSockets). */
export function wsEndpoint(): string {
  const base = process.env.NEXT_PUBLIC_TYR_WS_URL;
  if (base) return base;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:4000/ws`;
}

export const newKey = () => crypto.randomUUID().replaceAll("-", "");

export const usd = (n: number | string | null | undefined, digits = 2) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

export const cents = (px: number) => `${(px * 100).toFixed(1)}¢`;

export const explorer = {
  tempo: (tx: string) => `https://explore.testnet.tempo.xyz/tx/${tx}`,
  solana: (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
  solanaAccount: (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
};
