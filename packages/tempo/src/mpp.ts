// PRD 8.2 — MPP (HTTP 402) charges on Moderato via the official mppx SDK.
// The agent signs a TIP-20 transfer to tyr's treasury with its access key; tyr co-signs as fee
// payer, broadcasts and verifies it on-chain before serving. The access key's spend limit is the
// agent session cap, so an over-cap payment reverts on-chain and the request stays 402.
import { createHash, createHmac } from 'node:crypto';
import {
  isAddress,
  parseEventLogs,
  verifyMessage,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import { Abis } from 'viem/tempo';
import { Mppx, tempo } from 'mppx/server';
import { ALPHA_USD, STABLE_DECIMALS, publicClient, treasuryAccount } from './chain.js';

/** MPP challenge HMAC key, derived from TYR_SECRETS_KEY so no extra secret is needed. */
function secretKey(): string {
  const k = process.env.TYR_SECRETS_KEY;
  if (!k) throw new Error('TYR_SECRETS_KEY not set');
  return createHmac('sha256', Buffer.from(k, 'hex')).update('tyr:mpp').digest('base64');
}

export function createMpp() {
  return Mppx.create({
    methods: [
      tempo.charge({
        testnet: true,
        currency: ALPHA_USD,
        decimals: STABLE_DECIMALS,
        recipient: treasuryAccount().address,
        feePayer: treasuryAccount(),
        feeToken: ALPHA_USD,
        allowedFeeTokens: [ALPHA_USD],
        getClient: () => publicClient(),
      }),
    ],
    secretKey: secretKey(),
  });
}

export type Mpp = ReturnType<typeof createMpp>;

/** The tx hash an MPP `Payment-Receipt` header refers to. */
export function receiptReference(res: Response): Hex {
  const raw = res.headers.get('payment-receipt');
  if (!raw) throw new Error('response has no Payment-Receipt');
  const r = JSON.parse(Buffer.from(raw, 'base64url').toString()) as { reference: string };
  return r.reference as Hex;
}

/** Trust the chain: the AlphaUSD transfers into tyr's treasury in a confirmed payment tx. */
export async function paymentTransfers(hash: Hex) {
  const receipt = await publicClient().getTransactionReceipt({ hash });
  if (receipt.status !== 'success') return [];
  const treasury = treasuryAccount().address.toLowerCase();
  return parseEventLogs({ abi: Abis.tip20, eventName: 'Transfer', logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === ALPHA_USD && l.args.to.toLowerCase() === treasury)
    .map((l) => ({ from: l.args.from, amount: l.args.amount }));
}

// PRD 8.1 — agents authenticate every request with their session key (no bearer secret).
// Signature = EIP-191 over "tyr-agent:<METHOD>:<path>:<timestampMs>:<sha256(body)>".
const AGENT_SKEW_MS = 60_000;
const agentMessage = (method: string, path: string, ts: string, body: string) =>
  `tyr-agent:${method.toUpperCase()}:${path}:${ts}:${createHash('sha256').update(body).digest('hex')}`;

export async function signAgentRequest(
  account: LocalAccount,
  req: { method: string; path: string; body?: string },
): Promise<Record<string, string>> {
  const ts = String(Date.now());
  return {
    'x-tyr-agent': account.address,
    'x-tyr-timestamp': ts,
    'x-tyr-signature': await account.signMessage({
      message: agentMessage(req.method, req.path, ts, req.body ?? ''),
    }),
  };
}

/** The agent address that signed this request, or null. */
export async function verifyAgentRequest(req: {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}): Promise<Address | null> {
  const h = (k: string) => {
    const v = req.headers[k];
    return typeof v === 'string' ? v : undefined;
  };
  const agent = h('x-tyr-agent');
  const ts = h('x-tyr-timestamp');
  const sig = h('x-tyr-signature');
  if (!agent || !ts || !sig || !isAddress(agent)) return null;
  if (Math.abs(Date.now() - Number(ts)) > AGENT_SKEW_MS) return null;
  const ok = await verifyMessage({
    address: agent,
    message: agentMessage(req.method, req.path, ts, req.body),
    signature: sig as Hex,
  }).catch(() => false);
  return ok ? agent : null;
}
