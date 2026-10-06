// tyr reference agent (PRD 8.4) — trades on testnet through the tyr Agent API.
//
// The agent only holds its own secp256k1 key. Its owner registered that key as a capped agent
// session (a Tempo access key on the owner's account, spend limit = cap). Every request is signed
// with the key; paid endpoints answer 402 and mppx pays them on Tempo Moderato through the access
// key, so the chain stops the agent at its cap.
//
//   TYR_API_URL=http://localhost:4000 AGENT_PRIVATE_KEY=0x… pnpm --filter @tyr/examples agent
import { createHash } from 'node:crypto';
import { Mppx, tempo } from 'mppx/client';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Account } from 'viem/tempo';

type Market = { outcome: number; name?: string; yes: { bid: number; ask: number } };
type Level = { px: string; sz: string };

export type AgentRun = {
  owner: Address;
  outcome: number;
  dataPaymentTx: string;
  bet: Record<string, unknown> & { id: string; step: string; tempoStakeTx: string };
  evidence: Record<string, unknown>;
};

export async function runAgent(opts: {
  baseUrl: string;
  privateKey: Hex;
  stakeUsd: number;
  log?: (msg: string) => void;
}): Promise<AgentRun> {
  const log = opts.log ?? console.log;
  const signer = privateKeyToAccount(opts.privateKey);

  // Every request is signed: EIP-191 over "tyr-agent:<METHOD>:<path>:<ts>:<sha256(body)>".
  async function signed(method: string, path: string, body?: unknown): Promise<RequestInit> {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const ts = String(Date.now());
    const digest = createHash('sha256').update(raw).digest('hex');
    const signature = await signer.signMessage({
      message: `tyr-agent:${method}:${path}:${ts}:${digest}`,
    });
    return {
      method,
      headers: {
        'x-tyr-agent': signer.address,
        'x-tyr-timestamp': ts,
        'x-tyr-signature': signature,
        ...(raw ? { 'content-type': 'application/json' } : {}),
      },
      ...(raw ? { body: raw } : {}),
    };
  }

  async function call<T>(method: string, path: string, body?: unknown, pay?: typeof fetch) {
    const res = await (pay ?? fetch)(opts.baseUrl + path, await signed(method, path, body));
    const json = (await res.json()) as T & { error?: unknown };
    if (!res.ok)
      throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json.error)}`);
    return json;
  }

  // 1. who am I paying for?
  const me = await call<{ owner: Address; capUsd: number; remainingUsd: number }>(
    'GET',
    '/api/agent/me',
  );
  log(`session: owner ${me.owner}, cap $${me.capUsd}, remaining $${me.remainingUsd}`);

  // mppx pays 402s with the agent key acting for the owner's account (access key).
  const payer = Mppx.create({
    methods: [tempo({ account: Account.fromSecp256k1(opts.privateKey, { access: me.owner }) })],
    polyfill: false,
  });
  // The paid retry reuses the signed headers (same body, inside the 60s window) + the credential.
  const pay: typeof fetch = (input, init) => payer.fetch(input as string, init);

  // 2. free market list → pick the tightest YES spread
  const { markets } = await call<{ markets: Market[] }>('GET', '/api/agent/markets');
  const m = markets.reduce((a, b) => (b.yes.bid / b.yes.ask > a.yes.bid / a.yes.ask ? b : a));
  log(`market #${m.outcome} ${m.name ?? ''} yes ${m.yes.bid}/${m.yes.ask}`);

  // 3. paid market data (402 → pay → 200)
  const data = await call<{ books: { yes: { levels: Level[][] } }; paymentTx: string }>(
    'GET',
    `/api/agent/markets/${m.outcome}/data`,
    undefined,
    pay,
  );
  const ask = Number(data.books.yes.levels[1]?.[0]?.px ?? m.yes.ask);
  log(`paid for data: ${data.paymentTx} (best ask ${ask})`);

  // 4. bet — the 402 charge is the stake, capped on-chain by the session
  const bet = await call<AgentRun['bet']>(
    'POST',
    '/api/agent/bets',
    {
      outcome: m.outcome,
      side: 'yes',
      stakeUsd: opts.stakeUsd,
      idempotencyKey: crypto.randomUUID(),
    },
    pay,
  );
  log(`bet ${bet.id}: step ${bet.step}, stake tx ${bet.tempoStakeTx}`);

  // 5. paid evidence trail for the bet
  const evidence = await call<Record<string, unknown>>(
    'GET',
    `/api/agent/evidence/${bet.id}`,
    undefined,
    pay,
  );
  log(`evidence paid: ${String(evidence.paymentTx)}`);

  return { owner: me.owner, outcome: m.outcome, dataPaymentTx: data.paymentTx, bet, evidence };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await import('dotenv/config');
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error('AGENT_PRIVATE_KEY not set');
  await runAgent({
    baseUrl: process.env.TYR_API_URL ?? 'http://localhost:4000',
    privateKey: key,
    stakeUsd: Number(process.env.AGENT_STAKE_USD ?? 12),
  });
}
