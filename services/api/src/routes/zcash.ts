// PRD 7.3 / 11: POST /api/zcash/request → ZIP-321 URI for a shielded bet (Flow B). No session:
// the order, its stake and its return address all travel inside the encrypted memo.
// GET /api/zcash/orders/:txid → status of the order a shielded note created.
// GET /api/zcash/orders/:txid/disclosure → per-payout viewing-key receipt (PRD 7.7). Holding the
// order txid (only the payer knows it) is the capability to see this single payout.
import { verifyReceipt } from '@tyr/receipts';
import { ZcashRequestError, zcashDisclosure, zcashRequest } from '@tyr/zcash';
import type { TyrPlugin } from '../contract.js';
import {
  TxidParams,
  ZcashDisclosure,
  ZcashOrder,
  ZcashReceipt,
  ZcashRequest,
  ZcashRequestInput,
  errors,
} from '../schemas.js';

const tags = ['zcash'];

export const zcashRoutes: TyrPlugin = async (app) => {
  app.post(
    '/request',
    {
      schema: {
        tags,
        description: 'ZIP-321 payment request for a shielded bet (Flow B). No account needed.',
        body: ZcashRequestInput,
        response: { 200: ZcashRequest, ...errors(400) },
      },
    },
    async (req, reply) => {
      try {
        return await zcashRequest(req.body);
      } catch (e) {
        if (e instanceof ZcashRequestError) return reply.code(400).send({ error: e.message });
        throw e;
      }
    },
  );

  app.get(
    '/orders/:txid',
    { schema: { tags, params: TxidParams, response: { 200: ZcashOrder, ...errors(404) } } },
    async (req, reply) => {
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
      return zo;
    },
  );

  app.get(
    '/orders/:txid/disclosure',
    {
      schema: {
        tags,
        description: 'OVK view of the payout + FROST 2-of-3 check (the txid is the capability).',
        params: TxidParams,
        response: { 200: ZcashDisclosure, ...errors(404) },
      },
    },
    async (req, reply) => {
      const d = await zcashDisclosure(app.db, req.params.txid);
      if (!d) return reply.code(404).send({ error: 'no paid-out order for that txid' });
      return d;
    },
  );

  // PRD 10: Flow B bettors have no account, so the order txid is the capability (as above).
  app.get(
    '/orders/:txid/receipt',
    { schema: { tags, params: TxidParams, response: { 200: ZcashReceipt, ...errors(404) } } },
    async (req, reply) => {
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
    },
  );
};
