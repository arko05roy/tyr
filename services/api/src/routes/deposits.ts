// PRD 6 / 11: per-chain deposit addresses, deposit history, and claim-by-tx-hash for EVM deposits
// (required for ETH, optional fast path for USDC). The funding worker credits what's recorded.
import {
  DepositClaimError,
  claimEvmDeposit,
  creditDeposit,
  depositAddresses,
  evmSources,
  type EvmSourceKey,
} from '@tyr/evm-deposits';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireUser } from './session.js';

const Claim = z.object({
  chain: z.enum(Object.keys(evmSources()) as [EvmSourceKey, ...EvmSourceKey[]]),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

const STATUS = { not_found: 404, pending: 409, failed: 422, no_deposit: 422 } as const;

export const depositRoutes: FastifyPluginAsync = async (app) => {
  app.get('/addresses', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    return depositAddresses(app.db, user.id);
  });

  app.get('/', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const rows = await app.db.deposit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { deposits: rows };
  });

  app.post('/claim', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const body = Claim.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      const recorded = await claimEvmDeposit(
        app.db,
        user.id,
        body.data.chain,
        body.data.txHash as `0x${string}`,
      );
      // credit inline so the caller sees the result; the worker retries anything that fails here
      const deposits = [];
      for (const d of recorded) {
        try {
          deposits.push(await creditDeposit(app.db, d.id));
        } catch (e) {
          req.log.error(e, `credit ${d.id} deferred to worker`);
          deposits.push(await app.db.deposit.findUniqueOrThrow({ where: { id: d.id } }));
        }
      }
      return reply.code(201).send({ deposits });
    } catch (err) {
      if (err instanceof DepositClaimError)
        return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code });
      throw err;
    }
  });
};
