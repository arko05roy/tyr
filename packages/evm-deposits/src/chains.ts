// PRD 6.1 / 6.5 — EVM deposit sources. USDC addresses: Circle testnet USDC (HUMAN STOP 6,
// developers.circle.com, verified on-chain: symbol USDC, 6 decimals). Robinhood Chain testnet has
// no Circle USDC, so it accepts test ETH only (priced via Chainlink Sepolia ETH/USD, see fx.ts).
import { createPublicClient, defineChain, http, type Address, type Chain } from 'viem';
import { arbitrumSepolia, baseSepolia, sepolia } from 'viem/chains';

export type EvmSourceKey = 'sepolia' | 'baseSepolia' | 'arbSepolia' | 'robinhood';

export type EvmSource = {
  key: EvmSourceKey;
  chain: Chain;
  rpcEnv: string;
  usdc: Address | null;
  /** blocks behind head before a deposit counts (reorg safety) */
  confirmations: number;
  /** max getLogs block span per request (public RPC limits) */
  logChunk: bigint;
  /** first scan starts this many blocks back */
  lookback: bigint;
  explorer: string | null;
};

const robinhoodTestnet = () =>
  defineChain({
    id: Number(process.env.ROBINHOOD_CHAIN_ID ?? 0),
    name: 'Robinhood Chain testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL ?? ''] } },
  });

export function evmSources(): Record<EvmSourceKey, EvmSource> {
  return {
    sepolia: {
      key: 'sepolia',
      chain: sepolia,
      rpcEnv: 'SEPOLIA_RPC',
      usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      confirmations: 3,
      logChunk: 2_000n,
      lookback: 300n,
      explorer: 'https://sepolia.etherscan.io',
    },
    baseSepolia: {
      key: 'baseSepolia',
      chain: baseSepolia,
      rpcEnv: 'BASE_SEPOLIA_RPC',
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      confirmations: 5,
      logChunk: 2_000n,
      lookback: 1_800n,
      explorer: 'https://sepolia.basescan.org',
    },
    arbSepolia: {
      key: 'arbSepolia',
      chain: arbitrumSepolia,
      rpcEnv: 'ARB_SEPOLIA_RPC',
      usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      confirmations: 20,
      logChunk: 5_000n,
      lookback: 10_000n,
      explorer: 'https://sepolia.arbiscan.io',
    },
    robinhood: {
      key: 'robinhood',
      chain: robinhoodTestnet(),
      rpcEnv: 'ROBINHOOD_RPC_URL',
      usdc: null,
      confirmations: 20,
      logChunk: 5_000n,
      lookback: 0n,
      explorer: null,
    },
  };
}

export const USDC_DECIMALS = 6;

export function evmSource(key: EvmSourceKey): EvmSource {
  const s = evmSources()[key];
  if (!s) throw new Error(`unknown EVM deposit source ${key}`);
  return s;
}

export function evmClient(src: EvmSource) {
  const url = process.env[src.rpcEnv];
  if (!url) throw new Error(`${src.rpcEnv} not set`);
  return createPublicClient({ chain: src.chain, transport: http(url) });
}

export const evmExplorerTx = (src: EvmSource, hash: string) =>
  src.explorer ? `${src.explorer}/tx/${hash}` : hash;
