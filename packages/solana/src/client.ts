import { readFileSync } from 'node:fs';
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  getSignatureFromTransaction,
  pipe,
  getBase64EncodedWireTransaction,
  sequentialInstructionPlan,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type InstructionPlan,
  type KeyPairSigner,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';

/** Devnet genesis hash — the guard in @tyr/core checks the same value on boot. */
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export function rpcUrl(): string {
  const u = process.env.SOLANA_RPC_URL;
  if (!u) throw new Error('SOLANA_RPC_URL not set');
  return u;
}

let cached: ReturnType<typeof makeRpc> | undefined;
function makeRpc() {
  const http = rpcUrl();
  const base = createDefaultRpcTransport({ url: http });
  // Public devnet RPC rate-limits bursts (429); retry with backoff instead of failing a live test.
  const transport = (async (req: Parameters<typeof base>[0]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await base(req);
      } catch (e) {
        const status = (e as { context?: { statusCode?: number } }).context?.statusCode;
        if (status !== 429 || attempt >= 8) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }) as typeof base;
  return { rpc: createSolanaRpcFromTransport(transport) };
}
export function solana() {
  return (cached ??= makeRpc());
}
export type Rpc = ReturnType<typeof solana>['rpc'];

export async function assertDevnet(): Promise<void> {
  const g = await solana().rpc.getGenesisHash().send();
  if (g !== DEVNET_GENESIS) throw new Error(`Solana RPC is not devnet (genesis ${g})`);
}

export async function signerFromFile(path: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, 'utf8'))));
}

/** tyr treasury pays every fee and is the tyrUSD mint authority. */
export function treasury(): Promise<KeyPairSigner> {
  const p = process.env.SOLANA_TREASURY_KEYPAIR;
  if (!p) throw new Error('SOLANA_TREASURY_KEYPAIR not set');
  return signerFromFile(p);
}

type SignedTx = Awaited<ReturnType<typeof signTransactionMessageWithSigners>>;

/**
 * Send with preflight, then confirm by polling over HTTP. (Public devnet websockets drop often;
 * polling `getSignatureStatuses` is slower but reliable.) Throws on on-chain error or expiry.
 */
async function sendAndConfirm(tx: SignedTx, lastValidBlockHeight: bigint): Promise<Signature> {
  const { rpc } = solana();
  const signature = getSignatureFromTransaction(tx);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(tx), {
      encoding: 'base64',
      preflightCommitment: 'confirmed',
    })
    .send();
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const st = value[0];
    if (st?.err) throw Object.assign(new Error(`tx ${signature} failed`), { context: st.err });
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized'))
      return signature;
    const height = await rpc.getBlockHeight({ commitment: 'confirmed' }).send();
    if (height > lastValidBlockHeight) throw new Error(`tx ${signature} expired`);
    await new Promise((r) => setTimeout(r, 800));
  }
}

/** Plan → transactions → send sequentially, returning every confirmed signature in order. */
export async function sendPlan(
  plan: InstructionPlan,
  feePayer: TransactionSigner,
): Promise<Signature[]> {
  const { rpc } = solana();
  const planner = createTransactionPlanner({
    createTransactionMessage: () =>
      pipe(createTransactionMessage({ version: 0 }), (m) =>
        setTransactionMessageFeePayerSigner(feePayer, m),
      ),
  });
  const sigs: Signature[] = [];
  const executor = createTransactionPlanExecutor({
    executeTransactionMessage: async (context, message) => {
      const { value: blockhash } = await rpc.getLatestBlockhash().send();
      const tx = await signTransactionMessageWithSigners(
        setTransactionMessageLifetimeUsingBlockhash(blockhash, message),
      );
      context.transaction = tx;
      const signature = await sendAndConfirm(tx, blockhash.lastValidBlockHeight);
      sigs.push(signature);
      return { signature, transaction: tx };
    },
  });
  await executor(await planner(plan));
  return sigs;
}

export async function sendInstructions(
  ixs: Instruction[],
  feePayer: TransactionSigner,
): Promise<Signature> {
  const [sig] = await sendPlan(sequentialInstructionPlan(ixs), feePayer);
  if (!sig) throw new Error('no transaction sent');
  return sig;
}

/** Single-tx send without the planner (keeps instruction order/atomicity exact). */
export async function sendAtomic(ixs: Instruction[], feePayer: TransactionSigner) {
  const { rpc } = solana();
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m),
    ),
  );
  return sendAndConfirm(tx, blockhash.lastValidBlockHeight);
}

export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
