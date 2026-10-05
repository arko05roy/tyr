import { describe, expect, it } from 'vitest';
import {
  EVM_TESTNET_CHAIN_IDS,
  checkEvm,
  checkHyperliquid,
  loadConfig,
  runTestnetGuard,
} from '../src/index.js';

// Live: connects to every configured RPC. Requires a filled .env (HUMAN STOP 0).
const cfg = loadConfig();

describe('testnet guard (live)', () => {
  it('every configured RPC is the expected testnet', async () => {
    const checks = await runTestnetGuard(cfg);
    for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('fails when a live RPC does not match the expected chain id', async () => {
    // Real Tempo RPC, but we claim it should be Base Sepolia → must fail.
    const c = await checkEvm('mismatch', cfg.TEMPO_RPC_URL, EVM_TESTNET_CHAIN_IDS.baseSepolia);
    expect(c.ok).toBe(false);
  });

  it('refuses a configured mainnet chain id', async () => {
    const c = await checkEvm('mainnet', cfg.TEMPO_RPC_URL, 1);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/mainnet/);
  });

  it('refuses the Hyperliquid mainnet host without calling it', async () => {
    const c = await checkHyperliquid('https://api.hyperliquid.xyz');
    expect(c).toMatchObject({ ok: false, detail: 'mainnet API host' });
  });
});
