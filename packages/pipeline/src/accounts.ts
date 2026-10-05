// Per-user confidential bankroll (PRD 3.2, server-derived custody) + tyr escrow liquidity.
import type { PrismaClient } from '@tyr/db';
import {
  applyPending,
  ataOf,
  balance,
  createConfidentialAccount,
  deposit,
  elgamalAddress,
  escrowKeys,
  mintPublic,
  newUserSecret,
  userKeys,
  type UserKeys,
} from '@tyr/solana';

export async function confidentialAccount(db: PrismaClient, userId: string): Promise<UserKeys> {
  const existing = await db.confidentialAccount.findUnique({ where: { userId } });
  if (existing) return userKeys(existing.aeKeyRef);
  const sealed = newUserSecret();
  const keys = await userKeys(sealed);
  const { token } = await createConfidentialAccount(keys);
  await db.confidentialAccount.create({
    data: {
      userId,
      solanaTokenAccount: token,
      elgamalPubkey: elgamalAddress(keys.elgamal),
      aeKeyRef: sealed,
    },
  });
  return keys;
}

/** Available confidential balance (owner decrypt), applying pending credits first. */
export async function availableBalance(keys: UserKeys): Promise<bigint> {
  if ((await balance(keys)).pendingBalance > 0n) await applyPending(keys);
  return (await balance(keys)).availableBalance;
}

/**
 * Escrow must hold `amount` available before paying out. Stakes land as pending credits; if
 * those don't cover a winning payout, the treasury (tyrUSD mint authority = house float) tops up.
 * The top-up's deposit tx is returned so the settlement records exactly when the house paid.
 */
export async function ensureEscrowLiquidity(
  amount: bigint,
): Promise<{ escrow: UserKeys; topUpTx: string | null }> {
  const escrow = await escrowKeys();
  await createConfidentialAccount(escrow);
  const have = await availableBalance(escrow);
  if (have >= amount) return { escrow, topUpTx: null };
  const topUp = amount - have;
  await mintPublic(await ataOf(escrow.owner.address), topUp);
  const topUpTx = await deposit(escrow, topUp);
  await applyPending(escrow);
  return { escrow, topUpTx };
}
