// PRD 2.2 — fee sponsorship. A JSON-RPC relay (viem/tempo Relay) that co-signs as fee payer.
// Browsers use: withRelay(http(TEMPO_RPC), http('<api>/api/tempo/sponsor')).
import { createClient, http, type Address } from 'viem';
import { Relay } from 'viem/tempo';
import { ALPHA_USD, chain, rpcUrl, treasuryAccount } from './chain.js';

export type SponsorPolicy = {
  /** Only sponsor senders that are tyr users (or their access keys' parent accounts). */
  isAllowed: (sender: Address) => Promise<boolean>;
  /** Max sponsored txs per sender per window. */
  maxPerWindow?: number;
  windowMs?: number;
};

export function createSponsorRelay(policy: SponsorPolicy) {
  const max = policy.maxPerWindow ?? 30;
  const windowMs = policy.windowMs ?? 60_000;
  const hits = new Map<string, number[]>();

  const rateOk = (sender: string) => {
    const now = Date.now();
    const recent = (hits.get(sender) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return false;
    recent.push(now);
    hits.set(sender, recent);
    return true;
  };

  return Relay.create({
    client: createClient({ chain, transport: http(rpcUrl()) }),
    plugins: [
      Relay.feePayer({
        account: treasuryAccount(),
        name: 'tyr.bet',
        // Required with `validate`: the plugin only auto-selects a fee token when no validator is set.
        feeToken: ALPHA_USD,
        async validate(request) {
          const sender = request.from as Address | undefined;
          if (!sender) return false;
          if (!(await policy.isAllowed(sender))) return false;
          return rateOk(sender.toLowerCase()) ? true : 'tx_fee_limit_exceeded';
        },
      }),
    ],
  });
}
