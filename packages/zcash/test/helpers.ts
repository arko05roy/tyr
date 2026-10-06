// Phase 7 test helpers — local Zcash regtest (owner-approved deviation, docs/human-values.md).
import { sidecar } from '../src/sidecar.js';

export const tyr = sidecar(process.env.ZCASH_SIDECAR_URL ?? 'http://127.0.0.1:7200');
export const user = sidecar(process.env.ZCASH_USER_SIDECAR_URL ?? 'http://127.0.0.1:7201');
export const ev = (label: string, v: string) => console.log(`[evidence] ${label}: ${v}`);

const rpc = async (method: string, params: unknown[] = []) => {
  const r = await fetch(process.env.ZCASH_REGTEST_RPC ?? 'http://127.0.0.1:18232', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await r.json()) as { result: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

export const height = async () => Number(await rpc('getblockcount'));
/** regtest only: mine n blocks, then wait until both wallets (via zaino, which lags zebrad) reach them */
export async function mine(n: number) {
  const target = (await height()) + n;
  await rpc('generate', [n]);
  for (const w of [tyr, user])
    await until(async () => (await w.sync()).height >= target, `wallet sync to ${target}`, 60_000);
}

export async function until<T>(
  f: () => Promise<T | undefined | null | false>,
  what: string,
  ms = 180_000,
) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`missing ${what}`);
  return v;
}
