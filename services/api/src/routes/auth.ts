import { loginOptions, registrationOptions, verifyLogin, verifyRegistration } from '@tyr/tempo';
import { hedgeEligibility, isValidRegion, normalizeRegion } from '@tyr/robinhood';
import type { FastifyPluginAsync } from 'fastify';
import { requireUser, startSession } from './session.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/passkey/register/options', async () => registrationOptions(app.db));

  app.post('/passkey/register/verify', async (req, reply) => {
    try {
      const user = await verifyRegistration(app.db, req.body as never);
      await startSession(req, reply, user.id);
      return { userId: user.id, tempoAddress: user.tempoAddress };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/passkey/login/options', async () => loginOptions(app.db));

  app.post('/passkey/login/verify', async (req, reply) => {
    try {
      const user = await verifyLogin(app.db, req.body as never);
      await startSession(req, reply, user.id);
      return { userId: user.id, tempoAddress: user.tempoAddress };
    } catch (e) {
      return reply.code(401).send({ error: (e as Error).message });
    }
  });

  app.get('/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    return { userId: user.id, tempoAddress: user.tempoAddress, region: user.region };
  });

  // PRD 9.1 (Stop 9): self-declared region gates the hedge. ISO 3166-1 alpha-2.
  app.put('/region', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const region = (req.body as { region?: unknown } | null)?.region;
    if (typeof region !== 'string' || !isValidRegion(region))
      return reply.code(400).send({ error: 'region must be an ISO 3166-1 alpha-2 code' });
    const u = await app.db.user.update({
      where: { id: user.id },
      data: { region: normalizeRegion(region) },
    });
    return { region: u.region, hedge: hedgeEligibility(u.region) };
  });
};
