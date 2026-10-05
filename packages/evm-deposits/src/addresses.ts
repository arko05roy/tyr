// PRD 6.1 / 6.3 / 6.4 — per-user deposit endpoints, created on first request and stored in
// DepositAddress so watchers can map an incoming transfer back to its user.
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import type { Address as SolAddress } from '@solana/kit';
import { Prisma, type PrismaClient } from '@tyr/db';
import { confidentialAccount } from '@tyr/pipeline';
import { treasuryAccount } from '@tyr/tempo';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

/** Circle devnet USDC (classic SPL Token, 6 decimals) — HUMAN STOP 6, developers.circle.com. */
export const SOLANA_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as SolAddress;

function mnemonic(): string {
  const m = process.env.EVM_DEPOSIT_MNEMONIC;
  if (!m) throw new Error('EVM_DEPOSIT_MNEMONIC not set');
  return m;
}

/** HD-derived deposit EOA (m/44'/60'/0'/0/index); the same address on every EVM testnet. */
export const evmDepositAccount = (index: number) =>
  mnemonicToAccount(mnemonic(), { addressIndex: index });

/** memo32 a user puts on a Tempo transfer to the treasury to fund their bankroll. */
export const tempoDepositMemo = (userId: string): Hex => keccak256(toHex(`tyr:deposit:${userId}`));

export async function usdcAta(owner: SolAddress): Promise<SolAddress> {
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint: SOLANA_DEVNET_USDC,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return ata;
}

async function evmAddress(db: PrismaClient, userId: string): Promise<Address> {
  const found = await db.depositAddress.findUnique({
    where: { userId_chain: { userId, chain: 'evm' } },
  });
  if (found) return found.address as Address;
  for (let attempt = 0; ; attempt++) {
    const max = await db.depositAddress.aggregate({ _max: { hdIndex: true } });
    const hdIndex = (max._max.hdIndex ?? -1) + 1;
    const address = evmDepositAccount(hdIndex).address;
    try {
      await db.depositAddress.create({ data: { userId, chain: 'evm', address, hdIndex } });
      return address;
    } catch (e) {
      // another request took this index (or this user) concurrently — re-read and retry
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002' || attempt > 5)
        throw e;
      const mine = await db.depositAddress.findUnique({
        where: { userId_chain: { userId, chain: 'evm' } },
      });
      if (mine) return mine.address as Address;
    }
  }
}

async function upsertAddress(db: PrismaClient, userId: string, chain: string, address: string) {
  await db.depositAddress.upsert({
    where: { userId_chain: { userId, chain } },
    create: { userId, chain, address },
    update: {},
  });
}

export type DepositAddresses = {
  evm: { address: Address; chains: string[]; assets: Record<string, string[]> };
  solana: { owner: SolAddress; usdcAta: SolAddress; usdcMint: SolAddress };
  tempo: { to: Address; memo: Hex; token: string };
};

export async function depositAddresses(
  db: PrismaClient,
  userId: string,
): Promise<DepositAddresses> {
  const evm = await evmAddress(db, userId);
  const keys = await confidentialAccount(db, userId);
  const owner = keys.owner.address;
  await upsertAddress(db, userId, 'solana', owner);
  const memo = tempoDepositMemo(userId);
  await upsertAddress(db, userId, 'tempo', memo);
  return {
    evm: {
      address: evm,
      chains: ['sepolia', 'baseSepolia', 'arbSepolia', 'robinhood'],
      assets: {
        sepolia: ['USDC', 'ETH'],
        baseSepolia: ['USDC', 'ETH'],
        arbSepolia: ['USDC', 'ETH'],
        robinhood: ['ETH'],
      },
    },
    solana: { owner, usdcAta: await usdcAta(owner), usdcMint: SOLANA_DEVNET_USDC },
    tempo: { to: treasuryAccount().address, memo, token: 'AlphaUSD' },
  };
}
