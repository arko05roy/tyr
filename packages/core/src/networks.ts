/**
 * Canonical testnet identifiers. Values here are public network constants, not secrets.
 * Tempo and Robinhood Chain testnet IDs come from config (human-supplied, HUMAN STOP 0).
 */
export const EVM_TESTNET_CHAIN_IDS = {
  sepolia: 11155111,
  baseSepolia: 84532,
  arbSepolia: 421614,
} as const;

/** Mainnet EVM chain IDs that must never be reachable from this repo. */
export const EVM_MAINNET_CHAIN_IDS = new Set<number>([
  1, // Ethereum
  8453, // Base
  42161, // Arbitrum One
  42170, // Arbitrum Nova
  10, // Optimism
  137, // Polygon
  56, // BNB
  999, // HyperEVM mainnet
]);

export const SOLANA_GENESIS = {
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dHhQme',
} as const;

export const HL_TESTNET_HOST = 'api.hyperliquid-testnet.xyz';
export const HL_MAINNET_HOST = 'api.hyperliquid.xyz';

/** lightwalletd GetLightdInfo.chainName */
export const ZCASH_TESTNET_CHAIN_NAME = 'test';
