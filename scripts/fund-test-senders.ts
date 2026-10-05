// Seed the Phase 6 test "user" wallets from tyr's own testnet wallets (gas only):
//   Solana devnet SOL ← treasury; Robinhood testnet ETH ← RH hot wallet.
// Circle testnet USDC (Sepolia / Base Sepolia / Arb Sepolia / Solana devnet) and Sepolia-family gas
// ETH must come from faucets (faucet.circle.com etc.) — tyr holds none to give.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createWalletClient, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmClient, evmSource } from '@tyr/evm-deposits';

const sender = privateKeyToAccount(process.env.EVM_TEST_SENDER_KEY as Hex).address;
const solSender = execFileSync('solana-keygen', [
  'pubkey',
  process.env.SOLANA_TEST_SENDER_KEYPAIR ?? '',
])
  .toString()
  .trim();

const sol = execFileSync('solana', [
  'transfer',
  solSender,
  '0.2',
  '-u',
  'devnet',
  '--allow-unfunded-recipient',
  '-k',
  process.env.SOLANA_TREASURY_KEYPAIR ?? '',
]).toString();
console.log('SOL →', solSender, sol.trim().split('\n').pop());

const rh = evmSource('robinhood');
const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.ROBINHOOD_HOT_WALLET_KEY as Hex),
  chain: rh.chain,
  transport: http(process.env.ROBINHOOD_RPC_URL),
});
const hash = await wallet.sendTransaction({ to: sender, value: parseEther('0.004') });
const r = await evmClient(rh).waitForTransactionReceipt({ hash });
console.log('RH ETH →', sender, hash, r.status);
