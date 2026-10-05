// Spike S3 — Tempo Moderato: passkey account + sponsored batch + on-chain access-key spend limit.
//   1. "user" = headless WebAuthn (P-256) account — real WebAuthn signatures, no browser.
//   2. sponsor funds user with 10 AlphaUSD.
//   3. user sends ONE batched tx (transfer + transferWithMemo), fee paid by sponsor → user fee spend = 0.
//   4. user authorizes an access key limited to $5 AlphaUSD.
//   5. access key spends $4 ✅, then $2 ❌ (rejected by the chain).
import 'dotenv/config';
import {
  createClient,
  encodeFunctionData,
  http,
  keccak256,
  publicActions,
  toHex,
  walletActions,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { tempoModerato } from 'viem/chains';
import { Abis, Account, Actions, P256, Relay, withRelay } from 'viem/tempo';

const ALPHA_USD = '0x20c0000000000000000000000000000000000001' as const;
const usd = (n: number) => BigInt(Math.round(n * 1e6));
const fmt = (v: bigint) => (Number(v) / 1e6).toFixed(6);
const tx = (h: Hex) => `${h}  ${tempoModerato.blockExplorers.default.url}/tx/${h}`;

const sponsorKey = process.env.TEMPO_SPONSOR_PRIVATE_KEY as Hex;
if (!sponsorKey) throw new Error('missing TEMPO_SPONSOR_PRIVATE_KEY');
const sponsor = privateKeyToAccount(sponsorKey);
const chain = tempoModerato.extend({ feeToken: ALPHA_USD });

// 1. passkey user (rpId/origin match local dev; HUMAN STOP 2 sets production values)
const passkeyPriv = P256.randomPrivateKey();
const user = Account.fromHeadlessWebAuthn(passkeyPriv, {
  rpId: 'localhost',
  origin: 'http://localhost:3000',
});
const recipient = privateKeyToAccount(generatePrivateKey()).address;
console.log(
  `sponsor ${sponsor.address}\nuser    ${user.address} (WebAuthn P-256)\nrecipient ${recipient}`,
);

const sponsorClient = createClient({ account: sponsor, chain, transport: http() }).extend(
  publicActions,
);
const userClient = createClient({
  account: user,
  chain,
  transport: withRelay(http(), { plugins: [Relay.feePayer({ account: sponsor })] }),
}).extend(walletActions);
const balanceOf = (who: Hex) =>
  sponsorClient.readContract({
    address: ALPHA_USD,
    abi: Abis.tip20,
    functionName: 'balanceOf',
    args: [who],
  });
const transferCall = (to: Hex, amount: bigint, memo?: Hex) => ({
  to: ALPHA_USD,
  data: memo
    ? encodeFunctionData({
        abi: Abis.tip20,
        functionName: 'transferWithMemo',
        args: [to, amount, memo],
      })
    : encodeFunctionData({ abi: Abis.tip20, functionName: 'transfer', args: [to, amount] }),
});

// 2. fund user
const fund = await Actions.token.transferSync(sponsorClient, {
  token: ALPHA_USD,
  to: user.address,
  amount: usd(10),
});
console.log(`\n2. fund user 10 AlphaUSD: ${tx(fund.receipt.transactionHash)}`);

// 3. sponsored batch
const before = await balanceOf(user.address);
const memo = keccak256(toHex('tyr-spike-s3'));
const batchHash = await userClient.sendTransaction({
  calls: [transferCall(recipient, usd(1)), transferCall(recipient, usd(1), memo)],
  feePayer: true,
} as never);
const batch = await sponsorClient.waitForTransactionReceipt({ hash: batchHash });
const after = await balanceOf(user.address);
console.log(`3. sponsored batch (2 calls): ${tx(batchHash)} status=${batch.status}`);
console.log(
  `   user AlphaUSD ${fmt(before)} → ${fmt(after)} (spent ${fmt(before - after)}; transfers = 2.000000)`,
);
if (batch.status !== 'success') throw new Error('batch failed');
if (before - after !== usd(2)) throw new Error('✗ user paid fees — sponsorship not applied');

// 4. access key with $5 limit
const accessKey = Account.fromP256(P256.randomPrivateKey(), { access: user });
const authHash = await Actions.accessKey.authorize(userClient, {
  accessKey,
  expiry: Math.floor(Date.now() / 1000) + 3600,
  limits: [{ token: ALPHA_USD, limit: usd(5) }],
  feePayer: true,
} as never);
await sponsorClient.waitForTransactionReceipt({ hash: authHash });
console.log(`4. access key ${accessKey.accessKeyAddress} authorized, limit $5: ${tx(authHash)}`);

const keyClient = createClient({
  account: accessKey,
  chain,
  transport: withRelay(http(), { plugins: [Relay.feePayer({ account: sponsor })] }),
}).extend(walletActions);
const spend = (amount: bigint) =>
  keyClient.sendTransaction({ calls: [transferCall(recipient, amount)], feePayer: true } as never);

// 5a. $4 within limit
const ok = await sponsorClient.waitForTransactionReceipt({ hash: await spend(usd(4)) });
console.log(`5a. access key spends $4: ${tx(ok.transactionHash)} status=${ok.status}`);
if (ok.status !== 'success') throw new Error('✗ $4 spend should succeed');

// 5b. $2 exceeds remaining $1
try {
  const h = await spend(usd(2));
  const r = await sponsorClient.waitForTransactionReceipt({ hash: h });
  if (r.status === 'success') throw new Error(`✗ over-limit spend succeeded: ${h}`);
  console.log(`5b. over-limit $2 reverted on-chain: ${tx(h)}`);
} catch (err) {
  const msg = (err as Error).message;
  if (msg.startsWith('✗')) throw err;
  console.log(`5b. over-limit $2 rejected by chain: ${msg.split('\n').slice(0, 3).join(' | ')}`);
}
console.log('\n✓ S3 PASS');
