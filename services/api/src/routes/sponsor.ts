// PRD 2.2: JSON-RPC fee-sponsor relay. Browser: withRelay(http(TEMPO_RPC), http('/api/tempo/sponsor')).
import { createSponsorRelay } from '@tyr/tempo';
import { getAddress } from 'viem';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';

export const sponsorRoutes: TyrPlugin = async (app) => {
  const relay = createSponsorRelay({
    // Sponsor only tyr users' accounts (access-key txs carry the parent account as sender).
    isAllowed: async (sender) =>
      !!(await app.db.user.findUnique({ where: { tempoAddress: getAddress(sender) } })),
  });

  const Rpc = z.unknown().describe('JSON-RPC request/response (Tempo fee-payer relay)');
  app.post(
    '/sponsor',
    {
      schema: {
        tags: ['tempo'],
        description:
          'Fee-payer relay: co-signs txs sent by tyr users. Use as the relay transport of withRelay().',
        body: Rpc,
        response: { 200: Rpc, '4xx': Rpc, '5xx': Rpc },
      },
    },
    async (req, reply) => {
      const res = await relay.fetch(
        new Request('http://relay/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req.body),
        }),
      );
      reply.code(res.status as 200).header('content-type', 'application/json');
      return reply.send(await res.text());
    },
  );
};
