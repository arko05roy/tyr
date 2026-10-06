// PRD 7.3 / 11: POST /api/zcash/request → ZIP-321 URI for a shielded bet (Flow B). No session:
// the order, its stake and its return address all travel inside the encrypted memo.
// GET /api/zcash/orders/:txid → status of the order a shielded note created.
// GET /api/zcash/orders/:txid/disclosure → per-payout viewing-key receipt (PRD 7.7). Holding the
// order txid (only the payer knows it) is the capability to see this single payout.
import { verifyReceipt } from '@tyr/receipts';
import { ZcashRequestError, zcashDisclosure, zcashRequest } from '@tyr/zcash';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const Req = z.object({
  outcome: z.number().int().nonnegative(),
  side: z.enum(['yes', 'no']),
  stakeUsd: z.number().positive().max(10_000),
  returnUA: z
    .string()
    .regex(/^u(1|test1|regtest1)[0-9a-z]+$/)
    .max(255),
});

export const zcashRoutes: FastifyPluginAsync = async (app) => {
  app.post('/request', async (req, reply) => {
    const body = Req.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      return await zcashRequest(body.data);
    } catch (e) {
      if (e instanceof ZcashRequestError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.get<{ Params: { txid: string } }>('/orders/:txid', async (req, reply) => {
    const zo = await app.db.zcashOrder.findUnique({
      where: { txid: req.params.txid },
      select: {
        id: true,
        txid: true,
        status: true,
        marketId: true,
        side: true,
        size: true,
        zecUsd: true,
        payoutZat: true,
        payoutTxid: true,
        error: true,
        orderId: true,
      },
    });
    if (!zo) return reply.code(404).send({ error: 'no order for that txid yet' });
    return { ...zo, payoutZat: zo.payoutZat?.toString() ?? null };
  });

  app.get<{ Params: { txid: string } }>('/orders/:txid/disclosure', async (req, reply) => {
    const d = await zcashDisclosure(app.db, req.params.txid);
    if (!d) return reply.code(404).send({ error: 'no paid-out order for that txid' });
    return d;
  });

  // PRD 10: Flow B bettors have no account, so the order txid is the capability (as above).
  app.get<{ Params: { txid: string } }>('/orders/:txid/receipt', async (req, reply) => {
    const r = await app.db.receipt.findUnique({
      where: { kind_subjectId: { kind: 'zcash-payout', subjectId: req.params.txid } },
    });
    if (!r) return reply.code(404).send({ error: 'no receipt for that txid yet' });
    return {
      id: r.id,
      payloadHash: r.payloadHash,
      payload: r.payload,
      verification: await verifyReceipt(app.db, r),
    };
  });
};
