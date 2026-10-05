// Fund Hyperliquid TESTNET HyperCore accounts with Circle testnet USDC from Arc testnet via CCTP V2,
// forwarded into HyperCore by Circle's CctpForwarder — no HYPE gas needed (Arc gas is USDC).
// Docs: developers.circle.com/cctp/howtos/transfer-usdc-from-ethereum-to-hypercore
//
//   npx tsx scripts/arc-to-hypercore.ts <recipient 0x…> <usdc amount> [--send]
// Without --send it only prints balances + fees. Source wallet: HL_MASTER_PRIVATE_KEY on Arc testnet.
import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  http,
  pad,
  parseAbi,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
});
// Circle testnet addresses (cctp/evm-smart-contracts, cctp/references/hypercore-contract-addresses)
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const TOKEN_MESSENGER_V2 = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const CCTP_FORWARDER_HYPEREVM_TESTNET = '0x02e39ECb8368b41bF68FF99ff351aC9864e5E2a2';
const ARC_DOMAIN = 26;
const HYPEREVM_DOMAIN = 19;
const FAST = 1000;
const PERPS_DEX = 0;

/** Circle's documented CctpForwarder hook format: "cctp-forward" magic, version 0, recipient, dex. */
function forwardHookData(recipient: `0x${string}`, dex: number): `0x${string}` {
  const magic = Buffer.from('cctp-forward', 'utf-8').toString('hex').padEnd(48, '0');
  const dexHex = (dex >>> 0).toString(16).padStart(8, '0');
  return `0x${magic}00000000${'00000018'}${recipient.slice(2).toLowerCase()}${dexHex}`;
}

const [recipient, amountStr] = process.argv.slice(2);
const send = process.argv.includes('--send');
if (!recipient?.match(/^0x[0-9a-fA-F]{40}$/) || !amountStr) {
  throw new Error('usage: arc-to-hypercore.ts <recipient> <usdc amount> [--send]');
}

const pub = createPublicClient({ chain: arcTestnet, transport: http() });
if ((await pub.getChainId()) !== arcTestnet.id) throw new Error('not Arc testnet');
const account = privateKeyToAccount(process.env.HL_MASTER_PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });

const amount = parseUnits(amountStr, 6);
const balance = await pub.readContract({
  address: ARC_USDC,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
});

const fees = (await (
  await fetch(
    `https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/${ARC_DOMAIN}/${HYPEREVM_DOMAIN}?forward=true&hyperCoreDeposit=true`,
  )
).json()) as { finalityThreshold: number; minimumFee: number; forwardFee: { high: number } }[];
const fast = fees.find((f) => f.finalityThreshold === FAST);
if (!fast) throw new Error(`no fast-transfer fee quote: ${JSON.stringify(fees)}`);
// protocol fee (bps, rounded up) + forwarding fee (high quote)
const maxFee =
  (amount * BigInt(Math.ceil(fast.minimumFee * 100)) + 999_999n) / 1_000_000n +
  BigInt(fast.forwardFee.high);

console.log(`source ${account.address} Arc USDC ${Number(balance) / 1e6}`);
console.log(
  `→ HyperCore perps ${recipient}: ${amountStr} USDC, maxFee ${Number(maxFee) / 1e6} USDC`,
);
// Testnet rule (Circle docs, cctp-on-hypercore "Testnet recipient address limitations"): the recipient
// must already exist on HyperCore MAINNET, else the deposit fails silently and the USDC is lost.
// Read-only info query — no mainnet integration.
const role = (await (
  await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'userRole', user: recipient }),
  })
).json()) as { role: string };
console.log(`recipient mainnet role: ${role.role}`);
if (role.role === 'missing')
  throw new Error('recipient has no HyperCore mainnet state — deposit would be lost');

if (!send) {
  console.log('(dry run — add --send)');
  process.exit(0);
}
if (balance < amount) throw new Error('insufficient Arc USDC (leave a little for gas)');

const approve = await wallet.writeContract({
  address: ARC_USDC,
  abi: erc20Abi,
  functionName: 'approve',
  args: [TOKEN_MESSENGER_V2, amount],
});
await pub.waitForTransactionReceipt({ hash: approve });
const forwarder = pad(CCTP_FORWARDER_HYPEREVM_TESTNET, { size: 32 });
const burn = await wallet.writeContract({
  address: TOKEN_MESSENGER_V2,
  abi: parseAbi([
    'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
  ]),
  functionName: 'depositForBurnWithHook',
  args: [
    amount,
    HYPEREVM_DOMAIN,
    forwarder,
    ARC_USDC,
    forwarder,
    maxFee,
    FAST,
    forwardHookData(recipient as `0x${string}`, PERPS_DEX),
  ],
});
const r = await pub.waitForTransactionReceipt({ hash: burn });
console.log(`approve ${approve}\nburn    ${burn} status ${r.status}`);
console.log(`explorer https://explorer.testnet.arc.io/tx/${burn}`);
console.log('Circle attests + forwarder credits HyperCore in ~1 min.');
