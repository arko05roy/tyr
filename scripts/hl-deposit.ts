// Bridge Circle testnet USDC from HyperEVM → HyperCore perps for each HL wallet that holds it.
// Circle docs: developers.circle.com/cctp/howtos/transfer-usdc-from-hyperevm-to-hypercore
// Needs testnet HYPE on HyperEVM for gas.
import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const hyperEvmTestnet = defineChain({
  id: 998,
  name: 'HyperEVM Testnet',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid-testnet.xyz/evm'] } },
});
const USDC = '0x2B3370eE501B4a559b57D449569354196457D8Ab';
const CORE_DEPOSIT_WALLET = '0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206';
const PERPS_DEX = 0;

const pub = createPublicClient({ chain: hyperEvmTestnet, transport: http() });
if ((await pub.getChainId()) !== 998) throw new Error('not HyperEVM testnet');

for (const k of ['HL_MASTER_PRIVATE_KEY', 'HL_BUILDER_PRIVATE_KEY']) {
  const account = privateKeyToAccount(process.env[k] as `0x${string}`);
  const wallet = createWalletClient({ account, chain: hyperEvmTestnet, transport: http() });
  const [bal, gas] = await Promise.all([
    pub.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
    pub.getBalance({ address: account.address }),
  ]);
  console.log(`${k} ${account.address} USDC ${Number(bal) / 1e6} HYPE ${Number(gas) / 1e18}`);
  if (bal === 0n) continue;
  if (gas === 0n) {
    console.log('  ✗ no HYPE for gas — skipping');
    continue;
  }

  const approve = await wallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [CORE_DEPOSIT_WALLET, bal],
  });
  await pub.waitForTransactionReceipt({ hash: approve });
  const deposit = await wallet.writeContract({
    address: CORE_DEPOSIT_WALLET,
    abi: parseAbi(['function deposit(uint256 amount, uint32 destinationDex)']),
    functionName: 'deposit',
    args: [bal, PERPS_DEX],
  });
  const r = await pub.waitForTransactionReceipt({ hash: deposit });
  console.log(`  approve ${approve}\n  deposit ${deposit} status ${r.status}`);
}
