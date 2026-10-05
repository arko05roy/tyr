import {
  extension,
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getConfidentialDepositInstruction,
  getCreateMintInstructionPlan,
  getMintToCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from '@solana-program/token-2022';
import {
  decryptConfidentialTransferBalance,
  getApplyConfidentialPendingBalanceInstructionFromToken,
  getConfidentialTransferInstructionPlan,
  getConfidentialWithdrawInstructionPlan,
  getCreateConfidentialTransferAccountInstructionPlan,
} from '@solana-program/token-2022/confidential';
import {
  generateKeyPairSigner,
  lamports,
  some,
  type Address,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import { elgamalAddress, type UserKeys } from './keys.js';
import { sendInstructions, sendPlan, solana, treasury } from './client.js';
import type { ElGamalKeypair } from '@solana/zk-sdk';

export const TYRUSD_DECIMALS = 6;

export function tyrUsdMint(): Address {
  const m = process.env.SOLANA_TYRUSD_MINT;
  if (!m) throw new Error('SOLANA_TYRUSD_MINT not set (run scripts/solana-create-mint.ts)');
  return m as Address;
}

/** PRD 3.1 — Token-2022 mint with ConfidentialTransferMint (auto-approve, auditor key set). */
export async function createTyrUsdMint(auditor: ElGamalKeypair | null) {
  const payer = await treasury();
  const mint = await generateKeyPairSigner();
  const rpc = solana().rpc;
  const plan = await getCreateMintInstructionPlan(
    {
      getMinimumBalance: async (space) =>
        lamports(await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send()),
    },
    {
      payer,
      newMint: mint,
      decimals: TYRUSD_DECIMALS,
      mintAuthority: payer,
      extensions: [
        extension('ConfidentialTransferMint', {
          authority: some(payer.address),
          autoApproveNewAccounts: true,
          auditorElgamalPubkey: auditor ? some(elgamalAddress(auditor)) : null,
        }),
      ],
    },
    { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
  );
  const sigs = await sendPlan(plan, payer);
  return { mint: mint.address, sigs };
}

export async function ataOf(owner: Address, mint = tyrUsdMint()): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  return ata;
}

export async function loadToken(address: Address): Promise<Token> {
  return (await fetchToken(solana().rpc, address, { commitment: 'confirmed' })).data;
}

/** PRD 3.2 — create the ATA and configure it for CT with the user's ElGamal + AE keys. */
export async function createConfidentialAccount(keys: UserKeys): Promise<{
  token: Address;
  sigs: Signature[];
}> {
  const payer = await treasury();
  const mint = tyrUsdMint();
  const token = await ataOf(keys.owner.address, mint);
  const exists = await solana().rpc.getAccountInfo(token, { encoding: 'base64' }).send();
  if (exists.value) return { token, sigs: [] };
  const plan = await getCreateConfidentialTransferAccountInstructionPlan({
    payer,
    owner: keys.owner,
    mint,
    rpc: solana().rpc,
    elgamalKeypair: keys.elgamal,
    aesKey: keys.ae,
  });
  return { token, sigs: await sendPlan(plan, payer) };
}

/** Treasury mints public tyrUSD into an account (the stand-in for a credited deposit, Phase 6). */
export async function mintPublic(token: Address, amount: bigint): Promise<Signature> {
  const payer = await treasury();
  return sendInstructions(
    [
      getMintToCheckedInstruction({
        mint: tyrUsdMint(),
        token,
        mintAuthority: payer,
        amount,
        decimals: TYRUSD_DECIMALS,
      }),
    ],
    payer,
  );
}

/** PRD 3.3 — public balance → pending confidential balance. */
export async function deposit(keys: UserKeys, amount: bigint): Promise<Signature> {
  const token = await ataOf(keys.owner.address);
  return sendInstructions(
    [
      getConfidentialDepositInstruction({
        token,
        mint: tyrUsdMint(),
        authority: keys.owner,
        amount,
        decimals: TYRUSD_DECIMALS,
      }),
    ],
    await treasury(),
  );
}

/** PRD 3.3 — pending → available (decrypts pending locally, re-encrypts the new AE balance). */
export async function applyPending(keys: UserKeys): Promise<Signature> {
  const token = await ataOf(keys.owner.address);
  const ix = getApplyConfidentialPendingBalanceInstructionFromToken({
    token,
    tokenAccount: await loadToken(token),
    authority: keys.owner,
    elgamalSecretKey: keys.elgamal.secret(),
    aesKey: keys.ae,
  });
  return sendInstructions([ix], await treasury());
}

/**
 * PRD 3.3 — confidential transfer (equality + ciphertext-validity + range proofs, verified via
 * context-state accounts). Amount is encrypted to source, destination and the mint auditor.
 */
export async function confidentialTransfer(
  from: UserKeys,
  toOwner: Address,
  amount: bigint,
): Promise<Signature[]> {
  const payer = await treasury();
  const mint = tyrUsdMint();
  const sourceToken = await ataOf(from.owner.address, mint);
  const destinationToken = await ataOf(toOwner, mint);
  const plan = await getConfidentialTransferInstructionPlan({
    sourceToken,
    mint,
    mintAccount: (await fetchMint(solana().rpc, mint)).data,
    destinationToken,
    sourceTokenAccount: await loadToken(sourceToken),
    destinationTokenAccount: await loadToken(destinationToken),
    authority: from.owner,
    amount,
    sourceElgamalKeypair: from.elgamal,
    aesKey: from.ae,
    payer,
    rpc: solana().rpc,
  });
  return sendPlan(plan, payer);
}

/** PRD 3.3 — available confidential balance → public balance. */
export async function withdraw(keys: UserKeys, amount: bigint): Promise<Signature[]> {
  const payer = await treasury();
  const token = await ataOf(keys.owner.address);
  const plan = await getConfidentialWithdrawInstructionPlan({
    token,
    mint: tyrUsdMint(),
    tokenAccount: await loadToken(token),
    authority: keys.owner,
    amount,
    decimals: TYRUSD_DECIMALS,
    elgamalKeypair: keys.elgamal,
    aesKey: keys.ae,
    payer,
    rpc: solana().rpc,
  });
  return sendPlan(plan, payer);
}

/** Owner-only decrypt of available + pending balances. */
export async function balance(keys: UserKeys) {
  const tokenAccount = await loadToken(await ataOf(keys.owner.address));
  return {
    publicAmount: tokenAccount.amount,
    ...decryptConfidentialTransferBalance({
      tokenAccount,
      elgamalSecretKey: keys.elgamal.secret(),
      aesKey: keys.ae,
    }),
  };
}

/** Raw CT extension state (ciphertexts) — used to prove nothing plaintext is on-chain. */
export async function ctState(owner: Address) {
  const t = await loadToken(await ataOf(owner));
  const ext =
    t.extensions.__option === 'Some'
      ? t.extensions.value.find((e) => e.__kind === 'ConfidentialTransferAccount')
      : undefined;
  if (!ext || ext.__kind !== 'ConfidentialTransferAccount') throw new Error('not a CT account');
  return ext;
}

export type { KeyPairSigner };
