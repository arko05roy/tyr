// HUMAN STOP 6 FX rule: ETH deposits (any EVM source) are priced with the Chainlink ETH/USD feed
// on Sepolia (docs.chain.link → data feeds → Sepolia; verified on-chain: "ETH / USD", 8 decimals).
import { parseAbi, type Address } from 'viem';
import { evmClient, evmSource } from './chains.js';

export const CHAINLINK_ETH_USD_SEPOLIA: Address = '0x694AA1769357215DE4FAC081bf1f309aDC325306';
/** Reject a price older than this; the Sepolia feed heartbeat is well inside it. */
export const MAX_PRICE_AGE_S = 3 * 3600;

const aggregator = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

export type EthUsd = { price: bigint; decimals: number; roundId: bigint; updatedAt: bigint };

export async function ethUsd(): Promise<EthUsd> {
  const client = evmClient(evmSource('sepolia'));
  const [decimals, [roundId, answer, , updatedAt]] = await Promise.all([
    client.readContract({
      address: CHAINLINK_ETH_USD_SEPOLIA,
      abi: aggregator,
      functionName: 'decimals',
    }),
    client.readContract({
      address: CHAINLINK_ETH_USD_SEPOLIA,
      abi: aggregator,
      functionName: 'latestRoundData',
    }),
  ]);
  const age = BigInt(Math.floor(Date.now() / 1000)) - updatedAt;
  if (answer <= 0n) throw new Error(`Chainlink ETH/USD returned ${answer}`);
  if (age > BigInt(MAX_PRICE_AGE_S)) throw new Error(`Chainlink ETH/USD stale (${age}s old)`);
  return { price: answer, decimals, roundId, updatedAt };
}

/** wei → USD micro-units (tyrUSD, 6 decimals), rounded down. */
export const weiToUsdMicro = (wei: bigint, fx: EthUsd): bigint =>
  (wei * fx.price) / 10n ** BigInt(18 + fx.decimals - 6);

export const fxRateNumber = (fx: EthUsd) => Number(fx.price) / 10 ** fx.decimals;
