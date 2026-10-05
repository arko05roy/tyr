import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import {
  EVM_MAINNET_CHAIN_IDS,
  EVM_TESTNET_CHAIN_IDS,
  HL_MAINNET_HOST,
  HL_TESTNET_HOST,
  SOLANA_GENESIS,
  ZCASH_TESTNET_CHAIN_NAME,
} from './networks.js';

export type GuardCheck = { name: string; ok: boolean; detail: string };

export class TestnetGuardError extends Error {
  constructor(public readonly checks: GuardCheck[]) {
    const failed = checks.filter((c) => !c.ok).map((c) => `  ✗ ${c.name}: ${c.detail}`);
    super(`Testnet guard failed:\n${failed.join('\n')}`);
  }
}

async function jsonRpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method} → ${body.error.message}`);
  return body.result as T;
}

export async function checkEvm(name: string, rpc: string, expected: number): Promise<GuardCheck> {
  try {
    const actual = Number.parseInt(await jsonRpc<string>(rpc, 'eth_chainId'), 16);
    if (EVM_MAINNET_CHAIN_IDS.has(actual) || EVM_MAINNET_CHAIN_IDS.has(expected)) {
      return { name, ok: false, detail: `mainnet chain id ${actual} (configured ${expected})` };
    }
    return {
      name,
      ok: actual === expected,
      detail:
        actual === expected ? `chainId ${actual}` : `chainId ${actual} ≠ expected ${expected}`,
    };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message };
  }
}

export async function checkSolana(rpc: string): Promise<GuardCheck> {
  const name = 'solana';
  try {
    const hash = await jsonRpc<string>(rpc, 'getGenesisHash');
    if (hash === SOLANA_GENESIS.mainnet) return { name, ok: false, detail: 'mainnet-beta genesis' };
    const ok = hash === SOLANA_GENESIS.devnet;
    return { name, ok, detail: ok ? 'devnet genesis' : `unknown genesis ${hash}` };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message };
  }
}

export async function checkHyperliquid(apiUrl: string): Promise<GuardCheck> {
  const name = 'hyperliquid';
  const host = new URL(apiUrl).host;
  if (host === HL_MAINNET_HOST) return { name, ok: false, detail: 'mainnet API host' };
  if (host !== HL_TESTNET_HOST) return { name, ok: false, detail: `unexpected host ${host}` };
  // HL has no chain id endpoint; prove the testnet API is live and answering.
  try {
    const res = await fetch(new URL('/info', apiUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { name, ok: false, detail: `/info HTTP ${res.status}` };
    const meta = (await res.json()) as { universe?: unknown[] };
    return {
      name,
      ok: Array.isArray(meta.universe),
      detail: `testnet host, ${meta.universe?.length ?? 0} perps`,
    };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message };
  }
}

const PROTO = fileURLToPath(new URL('../proto/lightwalletd.proto', import.meta.url));

export async function checkZcash(endpoint: string): Promise<GuardCheck> {
  const name = 'zcash';
  try {
    const def = protoLoader.loadSync(PROTO, { keepCase: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = grpc.loadPackageDefinition(def) as any;
    const Svc = pkg.cash.z.wallet.sdk.rpc.CompactTxStreamer;
    const client = new Svc(endpoint, grpc.credentials.createSsl());
    const info = await new Promise<{ chainName: string; blockHeight: string }>((resolve, reject) =>
      client.GetLightdInfo({}, { deadline: Date.now() + 15_000 }, (e: Error | null, r: never) =>
        e ? reject(e) : resolve(r),
      ),
    ).finally(() => client.close());
    const ok = info.chainName === ZCASH_TESTNET_CHAIN_NAME;
    return { name, ok, detail: `chainName=${info.chainName} height=${info.blockHeight}` };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message };
  }
}

export async function runTestnetGuard(cfg: Config): Promise<GuardCheck[]> {
  const optional = [
    ['sepolia', cfg.SEPOLIA_RPC, EVM_TESTNET_CHAIN_IDS.sepolia],
    ['base-sepolia', cfg.BASE_SEPOLIA_RPC, EVM_TESTNET_CHAIN_IDS.baseSepolia],
    ['arb-sepolia', cfg.ARB_SEPOLIA_RPC, EVM_TESTNET_CHAIN_IDS.arbSepolia],
  ] as const;
  return Promise.all([
    checkEvm('tempo', cfg.TEMPO_RPC_URL, cfg.TEMPO_CHAIN_ID),
    checkEvm('robinhood', cfg.ROBINHOOD_RPC_URL, cfg.ROBINHOOD_CHAIN_ID),
    ...optional.flatMap(([n, rpc, id]) => (rpc ? [checkEvm(n, rpc, id)] : [])),
    checkSolana(cfg.SOLANA_RPC_URL),
    checkHyperliquid(cfg.HL_API_URL),
    checkZcash(cfg.ZCASH_LIGHTWALLETD_URL),
  ]);
}

/** Call on every service boot. Throws (→ process exits) if any RPC is not the expected testnet. */
export async function assertTestnets(cfg: Config): Promise<GuardCheck[]> {
  const checks = await runTestnetGuard(cfg);
  if (checks.some((c) => !c.ok)) throw new TestnetGuardError(checks);
  return checks;
}
