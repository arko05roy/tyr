// PRD 10 / 11: receipts. Private receipts are visible to their owner only; a public receipt can be
// read, proven and verified by anyone holding its id (the public verification page).
//   GET /api/receipts                  → the user's receipts
//   GET /api/receipts/:id              → payload + hash (owner, or anyone if public)
//   GET /api/receipts/:id/proof        → prove bundle: Tempo tx + memo, Solana opening + auditor
//                                         attestation, Zcash OVK + FROST disclosure
//   GET /api/receipts/:id/verify       → re-checks the receipt against the chains
//   PUT /api/receipts/:id/visibility   → { visibility: 'public' | 'private' } (owner)
import { proveReceipt, verifyReceipt } from '@tyr/receipts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import {
  IdParams,
  Proof,
  ReceiptDetail,
  ReceiptSummary,
  Verification,
  VisibilityInput,
  errors,
} from '../schemas.js';
import { authUser, sessionUser, userOf } from './session.js';

const tags = ['receipts'];
const owner = [{ session: [] }];
const ownerOrPublic = [{}, { session: [] }];

const summary = (r: {
  id: string;
  kind: string;
  subjectId: string | null;
  payloadHash: string;
  visibility: string;
  createdAt: Date;
}) => ({
  id: r.id,
  kind: r.kind,
  subjectId: r.subjectId,
  payloadHash: r.payloadHash,
  visibility: r.visibility,
  createdAt: r.createdAt,
});

export const receiptRoutes: TyrPlugin = async (app) => {
  /** The receipt if the caller may read it; otherwise replies 404 (no existence leak). */
  const readable = async (req: FastifyRequest, reply: FastifyReply, id: string) => {
    const r = await app.db.receipt.findUnique({ where: { id } });
    if (r && r.visibility === 'public') return r;
    const user = await sessionUser(req);
    if (r && user && r.userId === user.id) return r;
    reply.code(404).send({ error: 'no such receipt' });
    return null;
  };

  app.get(
    '/',
    {
      preValidation: authUser,
      schema: {
        tags,
        security: owner,
        response: { 200: z.object({ receipts: z.array(ReceiptSummary) }), ...errors(401) },
      },
    },
    async (req) => {
      const rs = await app.db.receipt.findMany({
        where: { userId: userOf(req).id },
        orderBy: { createdAt: 'desc' },
      });
      return { receipts: rs.map(summary) };
    },
  );

  const read = (description: string, response: z.ZodTypeAny) => ({
    schema: {
      tags,
      security: ownerOrPublic,
      description: `${description} Owner, or anyone if the receipt is public; 404 otherwise.`,
      params: IdParams,
      response: { 200: response, ...errors(404) },
    },
  });

  app.get('/:id', read('Receipt payload + hash.', ReceiptDetail), async (req, reply) => {
    const r = await readable(req, reply, req.params.id);
    if (!r) return;
    return { ...summary(r), payload: r.payload };
  });

  app.get(
    '/:id/proof',
    read(
      'Prove bundle: Tempo tx + memo, Solana commitment opening + auditor attestation, Zcash OVK view + FROST.',
      Proof,
    ),
    async (req, reply) => {
      const r = await readable(req, reply, req.params.id);
      if (!r) return;
      return proveReceipt(app.db, r);
    },
  );

  app.get(
    '/:id/verify',
    read('Re-checks the receipt against the chains (not the DB).', Verification),
    async (req, reply) => {
      const r = await readable(req, reply, req.params.id);
      if (!r) return;
      return verifyReceipt(app.db, r);
    },
  );

  app.put(
    '/:id/visibility',
    {
      preValidation: authUser,
      schema: {
        tags,
        security: owner,
        description:
          'Publish (proves first, so the public page serves the attested bundle) or hide.',
        params: IdParams,
        body: VisibilityInput,
        response: { 200: ReceiptSummary, ...errors(400, 401, 404) },
      },
    },
    async (req, reply) => {
      const user = userOf(req);
      const r = await app.db.receipt.findUnique({ where: { id: req.params.id } });
      if (!r || r.userId !== user.id) return reply.code(404).send({ error: 'no such receipt' });
      if (req.body.visibility === 'public') await proveReceipt(app.db, r);
      const u = await app.db.receipt.update({
        where: { id: r.id },
        data: { visibility: req.body.visibility },
      });
      return summary(u);
    },
  );
};
