// Spike S5 — Robinhood Chain hedge, SIMULATED swap leg (owner sign-off 2026-10-05, docs/human-values.md).
// Real: RH testnet chain id, the official faucet Stock Token contracts, the hot wallet's on-chain balances.
// Real price: Hyperliquid testnet `xyz` dex mid (no official Chainlink feed / Uniswap pool found on RH testnet).
// Simulated: the swap itself — quote = mid × (1 − 30bp pool fee − slippage); nothing is sent, no tx hash.
import 'dotenv/config';
import { createPublicClient, defineChain, erc20Abi, formatUnits, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const rhTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com'] },
  },
});
// Official faucet Stock Tokens (BeaconProxy → `Stock` impl), from the hot wallet's faucet claim.
export const STOCK_TOKENS: Record<string, Address> = {
  TSLA: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  AMD: '0x71178BAc73cBeb415514eB542a8995b82669778d',
  AMZN: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  NFLX: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  PLTR: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
};
const POOL_FEE_BPS = 30;
const SLIPPAGE_BPS = 20;

export type SimulatedHedge = {
  simulated: true;
  stock: string;
  token: Address;
  direction: 'buy' | 'sell';
  amountInUsd: number;
  priceUsd: number;
  priceSource: string;
  priceAt: number;
  amountOutShares: number;
  walletShareBalance: number;
};

async function hlMid(symbol: string): Promise<number> {
  const res = await fetch('https://api.hyperliquid-testnet.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'allMids', dex: 'xyz' }),
  });
  const mid = ((await res.json()) as Record<string, string>)[`xyz:${symbol}`];
  if (!mid) throw new Error(`no HL testnet xyz mid for ${symbol}`);
  return Number(mid);
}

const pub = createPublicClient({ chain: rhTestnet, transport: http() });
if ((await pub.getChainId()) !== 46630) throw new Error('not Robinhood Chain testnet');
const wallet = privateKeyToAccount(process.env.ROBINHOOD_HOT_WALLET_KEY as `0x${string}`).address;

export async function simulateHedge(stock: string, amountInUsd: number): Promise<SimulatedHedge> {
  const token = STOCK_TOKENS[stock];
  if (!token) throw new Error(`unknown stock ${stock}`);
  const [decimals, symbol, bal, priceUsd] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
    hlMid(stock),
  ]);
  if (symbol !== stock) throw new Error(`token symbol ${symbol} ≠ ${stock}`);
  const haircut = 1 - (POOL_FEE_BPS + SLIPPAGE_BPS) / 10_000;
  return {
    simulated: true,
    stock,
    token,
    direction: 'buy',
    amountInUsd,
    priceUsd,
    priceSource: `hyperliquid-testnet allMids dex=xyz xyz:${stock}`,
    priceAt: Date.now(),
    amountOutShares: (amountInUsd / priceUsd) * haircut,
    walletShareBalance: Number(formatUnits(bal, decimals)),
  };
}

const eth = await pub.getBalance({ address: wallet });
console.log(`hot wallet ${wallet}  ETH ${formatUnits(eth, 18)}`);
for (const s of Object.keys(STOCK_TOKENS)) {
  const h = await simulateHedge(s, 10);
  console.log(
    `${s.padEnd(5)} on-chain bal ${h.walletShareBalance}  px $${h.priceUsd}  $10 → ${h.amountOutShares.toFixed(6)} sh (simulated)`,
  );
  if (h.walletShareBalance <= 0 || h.amountOutShares <= 0) throw new Error(`✗ ${s}`);
}
console.log('✓ S5 PASS (simulated swap; real tokens, real chain, live testnet price)');
