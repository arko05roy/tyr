// Robinhood Chain testnet: official faucet Stock Tokens + the tyr hot wallet (custodial, disclosed).
// Addresses: docs/human-values.md → "Robinhood Chain testnet Stock Tokens (official faucet)".
import { createPublicClient, defineChain, erc20Abi, formatUnits, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const STOCK_TOKENS = {
  TSLA: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E',
  AMD: '0x71178BAc73cBeb415514eB542a8995b82669778d',
  AMZN: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02',
  NFLX: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93',
  PLTR: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0',
} as const satisfies Record<string, Address>;
export type StockSymbol = keyof typeof STOCK_TOKENS;
export const isStock = (s: string): s is StockSymbol => s in STOCK_TOKENS;

export const robinhoodChain = () =>
  defineChain({
    id: Number(process.env.ROBINHOOD_CHAIN_ID ?? 0),
    name: 'Robinhood Chain testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL ?? ''] } },
  });

export const rhClient = () => createPublicClient({ chain: robinhoodChain(), transport: http() });

export function hotWallet(): Address {
  const key = process.env.ROBINHOOD_HOT_WALLET_KEY;
  if (!key) throw new Error('ROBINHOOD_HOT_WALLET_KEY missing');
  return privateKeyToAccount(key as `0x${string}`).address;
}

/** On-chain hot-wallet inventory of a Stock Token (shares), with the token's symbol verified. */
export async function walletShares(symbol: StockSymbol): Promise<number> {
  const pub = rhClient();
  const token = STOCK_TOKENS[symbol];
  const [decimals, onchain, bal] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    pub.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [hotWallet()],
    }),
  ]);
  if (onchain !== symbol) throw new Error(`token ${token} symbol ${onchain} ≠ ${symbol}`);
  return Number(formatUnits(bal, decimals));
}
