// PRD 2.2: JSON-RPC fee-sponsor relay. Browser: withRelay(http(TEMPO_RPC), http('/api/tempo/sponsor')).
import { createSponsorRelay } from '@tyr/tempo';
import type { FastifyPluginAsync } from 'fastify';
import { getAddress } from 'viem';

export const sponsorRoutes: FastifyPluginAsync = async (app) => {
  const relay = createSponsorRelay({
    // Sponsor only tyr users' accounts (access-key txs carry the parent account as sender).
    isAllowed: async (sender) =>
      !!(await app.db.user.findUnique({ where: { tempoAddress: getAddress(sender) } })),
  });

  app.post('/sponsor', async (req, reply) => {
    const res = await relay.fetch(
      new Request('http://relay/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body),
      }),
    );
    reply.code(res.status).header('content-type', 'application/json');
    return reply.send(await res.text());
  });
};
