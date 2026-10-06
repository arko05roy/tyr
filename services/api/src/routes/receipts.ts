// PRD 10 / 11: receipts. Private receipts are visible to their owner only; a public receipt can be
// read, proven and verified by anyone holding its id (the public verification page).
//   GET /api/receipts                  → the user's receipts
//   GET /api/receipts/:id              → payload + hash (owner, or anyone if public)
//   GET /api/receipts/:id/proof        → prove bundle: Tempo tx + memo, Solana opening + auditor
//                                         attestation, Zcash OVK + FROST disclosure
//   GET /api/receipts/:id/verify       → re-checks the receipt against the chains
//   PUT /api/receipts/:id/visibility   → { visibility: 'public' | 'private' } (owner)
import { proveReceipt, verifyReceipt } from '@tyr/receipts';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser, sessionUser } from './session.js';

const Visibility = z.object({ visibility: z.enum(['public', 'private']) });

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

export const receiptRoutes: FastifyPluginAsync = async (app) => {
  /** The receipt if the caller may read it; otherwise replies 404 (no existence leak). */
  const readable = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const r = await app.db.receipt.findUnique({ where: { id: req.params.id } });
    if (r && r.visibility === 'public') return r;
    const user = await sessionUser(req);
    if (r && user && r.userId === user.id) return r;
    reply.code(404).send({ error: 'no such receipt' });
    return null;
  };

  app.get('/', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const rs = await app.db.receipt.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { receipts: rs.map(summary) };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const r = await readable(req, reply);
    if (!r) return;
    return { ...summary(r), payload: r.payload };
  });

  app.get<{ Params: { id: string } }>('/:id/proof', async (req, reply) => {
    const r = await readable(req, reply);
    if (!r) return;
    return proveReceipt(app.db, r);
  });

  app.get<{ Params: { id: string } }>('/:id/verify', async (req, reply) => {
    const r = await readable(req, reply);
    if (!r) return;
    return verifyReceipt(app.db, r);
  });

  app.put<{ Params: { id: string } }>('/:id/visibility', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const body = Visibility.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const r = await app.db.receipt.findUnique({ where: { id: req.params.id } });
    if (!r || r.userId !== user.id) return reply.code(404).send({ error: 'no such receipt' });
    // Publishing proves first, so the public page serves the attested bundle.
    if (body.data.visibility === 'public') await proveReceipt(app.db, r);
    const u = await app.db.receipt.update({
      where: { id: r.id },
      data: { visibility: body.data.visibility },
    });
    return summary(u);
  });
};
