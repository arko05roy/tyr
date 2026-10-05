// PRD 2.4 — loss limits as Tempo access keys. tyr's backend holds a P-256 access key that the
// user's passkey authorizes on-chain with a per-token spend limit; every stake debits through it,
// so the CHAIN enforces the cap (S3: over-limit → SpendingLimitExceeded).
import type { PrismaClient } from '@tyr/db';
import { createClient, http, walletActions, publicActions, type Address, type Hex } from 'viem';
import { Account, Actions, P256, Relay, withRelay } from 'viem/tempo';
import { transferCall } from './batch.js';
import { ALPHA_USD, chain, rpcUrl, treasuryAccount } from './chain.js';
import { open, seal } from './secrets.js';

export const PERIOD_SECONDS = { day: 86_400, week: 604_800 } as const;
export type Period = keyof typeof PERIOD_SECONDS;

/** Step 1 (backend): mint a fresh access key; only its public address leaves the server. */
export function newAccessKey(): { privateKey: Hex; accessKeyAddress: Address; sealed: string } {
  const privateKey = P256.randomPrivateKey();
  const { accessKeyAddress } = Account.fromP256(privateKey, {
    access: '0x0000000000000000000000000000000000000000',
  });
  return { privateKey, accessKeyAddress, sealed: seal(privateKey) };
}

/**
 * Step 2 (user's passkey, browser): authorize the key with a periodic limit. Shown here with any
 * viem/tempo root account — in the app this runs in the browser with the WebAuthn account.
 */
export async function authorizeAccessKey(params: {
  user: Account.Account;
  accessKeyAddress: Address;
  limitUsd: bigint;
  period: Period;
  expiresAt: Date;
  sponsorRelayUrl?: string;
}): Promise<Hex> {
  const transport = params.sponsorRelayUrl
    ? withRelay(http(rpcUrl()), http(params.sponsorRelayUrl))
    : withRelay(http(rpcUrl()), { plugins: [Relay.feePayer({ account: treasuryAccount() })] });
  const client = createClient({ account: params.user, chain, transport }).extend(publicActions);
  const hash = await Actions.accessKey.authorize(client, {
    accessKey: { accessKeyAddress: params.accessKeyAddress, keyType: 'p256' },
    expiry: Math.floor(params.expiresAt.getTime() / 1000),
    limits: [{ token: ALPHA_USD, limit: params.limitUsd, period: PERIOD_SECONDS[params.period] }],
    feePayer: true,
  } as never);
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`access key authorization reverted: ${hash}`);
  return hash;
}

/** Rebuild the backend's spending client for a user's stored loss limit. */
export function accessKeyClient(privateKey: Hex, userAddress: Address) {
  const account = Account.fromP256(privateKey, { access: userAddress });
  return createClient({
    account,
    chain,
    transport: withRelay(http(rpcUrl()), {
      plugins: [Relay.feePayer({ account: treasuryAccount() })],
    }),
  })
    .extend(publicActions)
    .extend(walletActions);
}

export async function remainingLimit(userAddress: Address, accessKeyAddress: Address) {
  const client = createClient({ chain, transport: http(rpcUrl()) });
  return Actions.accessKey.getRemainingLimit(client, {
    account: userAddress,
    accessKey: accessKeyAddress,
    token: ALPHA_USD,
  });
}

export class LimitExceededError extends Error {}

/**
 * Debit a stake from the user's account to tyr's treasury through the access key. The chain
 * rejects it if it would exceed the user's loss limit — we surface that as LimitExceededError.
 */
export async function debitStake(
  db: PrismaClient,
  params: { userId: string; amount: bigint; memo: Hex },
): Promise<Hex> {
  const user = await db.user.findUniqueOrThrow({ where: { id: params.userId } });
  const limit = await db.lossLimit.findFirst({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!limit) throw new Error('no active loss limit');
  const client = accessKeyClient(open(limit.accessKeyCipher) as Hex, user.tempoAddress as Address);
  try {
    const hash = await client.sendTransaction({
      calls: [transferCall(ALPHA_USD, treasuryAccount().address, params.amount, params.memo)],
      feePayer: true,
    } as never);
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new LimitExceededError(`stake reverted on-chain: ${hash}`);
    return hash;
  } catch (err) {
    if (err instanceof LimitExceededError) throw err;
    const msg = (err as Error).message;
    if (/SpendingLimitExceeded/.test(msg)) throw new LimitExceededError(msg.split('\n')[0]);
    throw err;
  }
}

export { seal };
