import { createHash } from 'node:crypto';
import { ElGamalCiphertext, type ElGamalKeypair } from '@solana/zk-sdk';
import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Encoder,
  getBase64Encoder,
  getPublicKeyFromAddress,
  signBytes,
  verifySignature,
  type Address,
  type ReadonlyUint8Array,
  type Signature,
  type SignatureBytes,
} from '@solana/kit';
import { solana } from './client.js';
import { auditorKeys } from './keys.js';

/** Signs attestations; derived from the auditor seed so the compliance holder owns both. */
export async function attestationSigner() {
  const s = process.env.SOLANA_AUDITOR_SEED;
  if (!s) throw new Error('SOLANA_AUDITOR_SEED not set');
  const seed = createHash('sha256').update('tyr/auditor-attest/v1').update(s, 'hex').digest();
  return createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed));
}

/** Find the Token-2022 ConfidentialTransfer instruction in a confirmed tx and return its data. */
export async function fetchTransferData(signature: Signature) {
  const tx = await solana()
    .rpc.getTransaction(signature, {
      commitment: 'confirmed',
      encoding: 'json',
      maxSupportedTransactionVersion: 0,
    })
    .send();
  if (!tx) throw new Error(`tx ${signature} not found`);
  const keys = tx.transaction.message.accountKeys;
  const b58 = getBase58Encoder();
  for (const ix of tx.transaction.message.instructions) {
    if (keys[ix.programIdIndex] !== TOKEN_2022_PROGRAM_ADDRESS) continue;
    const data = b58.encode(ix.data);
    if (
      data[0] === CONFIDENTIAL_TRANSFER_DISCRIMINATOR &&
      data[1] === CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR
    ) {
      const key = (i: number) => {
        const k = keys[ix.accounts[i] ?? -1];
        if (!k) throw new Error(`transfer ix missing account ${i}`);
        return k as Address;
      };
      return {
        mint: key(1),
        source: key(0),
        destination: key(2),
        data: getConfidentialTransferInstructionDataDecoder().decode(data),
      };
    }
  }
  throw new Error(`tx ${signature} has no confidential transfer`);
}

function decryptU(kp: ElGamalKeypair, bytes: ReadonlyUint8Array): bigint {
  const ct = ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
  if (!ct) throw new Error('malformed ciphertext');
  return kp.secret().decrypt(ct);
}

/** Transfer amounts are split lo (16 bits) / hi (32 bits); recombine after decrypting each. */
export function decryptAuditorAmount(
  kp: ElGamalKeypair,
  lo: ReadonlyUint8Array,
  hi: ReadonlyUint8Array,
) {
  return decryptU(kp, lo) + (decryptU(kp, hi) << 16n);
}

export type Attestation = {
  statement: {
    kind: 'tyr.solana.confidential-transfer-amount/v1';
    cluster: 'devnet';
    signature: Signature;
    mint: Address;
    source: Address;
    destination: Address;
    amount: string; // base units, decimal string
    attestedAt: string;
  };
  attester: Address;
  attestation: string; // base64 ed25519 over canonical JSON of `statement`
};

const canonical = (s: Attestation['statement']) =>
  new TextEncoder().encode(JSON.stringify(s, Object.keys(s).sort()));

/** PRD 3.5 — decrypt a transfer's amount with the auditor key and sign the result. */
export async function attestTransfer(signature: Signature): Promise<Attestation> {
  const { mint, source, destination, data } = await fetchTransferData(signature);
  const amount = decryptAuditorAmount(
    auditorKeys(),
    data.transferAmountAuditorCiphertextLo,
    data.transferAmountAuditorCiphertextHi,
  );
  const statement: Attestation['statement'] = {
    kind: 'tyr.solana.confidential-transfer-amount/v1',
    cluster: 'devnet',
    signature,
    mint,
    source,
    destination,
    amount: amount.toString(),
    attestedAt: new Date().toISOString(),
  };
  const signer = await attestationSigner();
  const sig = await signBytes(signer.keyPair.privateKey, canonical(statement));
  return {
    statement,
    attester: signer.address,
    attestation: Buffer.from(sig).toString('base64'),
  };
}

export async function verifyAttestation(a: Attestation): Promise<boolean> {
  const key = await getPublicKeyFromAddress(a.attester);
  const sig = getBase64Encoder().encode(a.attestation) as SignatureBytes;
  return verifySignature(key, sig, canonical(a.statement));
}
