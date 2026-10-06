import { loginOptions, registrationOptions, verifyLogin, verifyRegistration } from '@tyr/tempo';
import { hedgeEligibility, isValidRegion, normalizeRegion } from '@tyr/robinhood';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import {
  AuthResult,
  Eligibility,
  Me,
  WebAuthnOptions,
  WebAuthnResponse,
  errors,
} from '../schemas.js';
import { authUser, startSession, userOf } from './session.js';

const tags = ['auth'];

export const authRoutes: TyrPlugin = async (app) => {
  app.post(
    '/passkey/register/options',
    { schema: { tags, response: { 200: WebAuthnOptions } } },
    async () => registrationOptions(app.db),
  );

  app.post(
    '/passkey/register/verify',
    {
      schema: {
        tags,
        description: 'Verifies the attestation, creates the user, sets the session cookie.',
        body: WebAuthnResponse,
        response: { 200: AuthResult, ...errors(400) },
      },
    },
    async (req, reply) => {
      try {
        const user = await verifyRegistration(app.db, req.body as never);
        await startSession(req, reply, user.id);
        return { userId: user.id, tempoAddress: user.tempoAddress };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );

  app.post(
    '/passkey/login/options',
    { schema: { tags, response: { 200: WebAuthnOptions } } },
    async () => loginOptions(app.db),
  );

  app.post(
    '/passkey/login/verify',
    {
      schema: {
        tags,
        description: 'Verifies the assertion and sets the session cookie.',
        body: WebAuthnResponse,
        response: { 200: AuthResult, ...errors(400, 401) },
      },
    },
    async (req, reply) => {
      try {
        const user = await verifyLogin(app.db, req.body as never);
        await startSession(req, reply, user.id);
        return { userId: user.id, tempoAddress: user.tempoAddress };
      } catch (e) {
        return reply.code(401).send({ error: (e as Error).message });
      }
    },
  );

  app.get(
    '/me',
    {
      preValidation: authUser,
      schema: { tags, security: [{ session: [] }], response: { 200: Me, ...errors(401) } },
    },
    async (req) => {
      const user = userOf(req);
      return { userId: user.id, tempoAddress: user.tempoAddress, region: user.region };
    },
  );

  // PRD 9.1 (Stop 9): self-declared region gates the hedge. ISO 3166-1 alpha-2.
  app.put(
    '/region',
    {
      preValidation: authUser,
      schema: {
        tags,
        security: [{ session: [] }],
        body: z.object({ region: z.string().describe('ISO 3166-1 alpha-2') }),
        response: {
          200: z.object({ region: z.string().nullable(), hedge: Eligibility }),
          ...errors(400, 401),
        },
      },
    },
    async (req, reply) => {
      const user = userOf(req);
      if (!isValidRegion(req.body.region))
        return reply.code(400).send({ error: 'region must be an ISO 3166-1 alpha-2 code' });
      const u = await app.db.user.update({
        where: { id: user.id },
        data: { region: normalizeRegion(req.body.region) },
      });
      return { region: u.region, hedge: hedgeEligibility(u.region) };
    },
  );
};
