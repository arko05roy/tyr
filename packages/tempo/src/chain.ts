import { createClient, http, publicActions, walletActions, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { tempoModerato } from 'viem/chains';

/** AlphaUSD on Moderato — tyr's stablecoin for limits, stakes and payouts (HUMAN STOP 2 default). */
export const ALPHA_USD = '0x20c0000000000000000000000000000000000001' as const;
export const STABLE_DECIMALS = 6;

export const chain = tempoModerato.extend({ feeToken: ALPHA_USD });

export const usd = (n: number): bigint => BigInt(Math.round(n * 10 ** STABLE_DECIMALS));
export const fromUsd = (v: bigint): number => Number(v) / 10 ** STABLE_DECIMALS;

export function rpcUrl(): string {
  return process.env.TEMPO_RPC_URL ?? chain.rpcUrls.default.http[0];
}

export function publicClient() {
  return createClient({ chain, transport: http(rpcUrl()) }).extend(publicActions);
}

/**
 * tyr's Tempo hot wallet: fee sponsor, stake treasury and payout source (one key for the hackathon;
 * split roles before any real deployment).
 */
export function treasuryAccount() {
  const key = process.env.TEMPO_SPONSOR_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error('TEMPO_SPONSOR_PRIVATE_KEY not set');
  return privateKeyToAccount(key);
}

export function treasuryClient() {
  return createClient({ account: treasuryAccount(), chain, transport: http(rpcUrl()) })
    .extend(publicActions)
    .extend(walletActions);
}

export const explorerTx = (hash: Hex) => `${chain.blockExplorers.default.url}/tx/${hash}`;
