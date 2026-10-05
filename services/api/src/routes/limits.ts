// PRD 2.4: loss limits. prepare → (browser passkey authorizes access key on-chain) → confirm.
import {
  ALPHA_USD,
  PERIOD_SECONDS,
  fromUsd,
  newAccessKey,
  publicClient,
  remainingLimit,
} from '@tyr/tempo';
import type { FastifyPluginAsync } from 'fastify';
import type { Address, Hex } from 'viem';
import { z } from 'zod';
import { requireUser } from './session.js';

const Prepare = z.object({
  amountUsd: z.number().positive().max(10_000),
  period: z.enum(['day', 'week']),
});
const Confirm = z.object({ limitId: z.string(), txHash: z.string().regex(/^0x[0-9a-f]{64}$/i) });

export const limitRoutes: FastifyPluginAsync = async (app) => {
  app.post('/prepare', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const body = Prepare.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const key = newAccessKey();
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    const limit = await app.db.lossLimit.create({
      data: {
        userId: user.id,
        period: body.data.period,
        amountUsd: body.data.amountUsd,
        tempoAccessKeyId: key.accessKeyAddress,
        accessKeyCipher: key.sealed,
        token: ALPHA_USD,
        expiresAt,
      },
    });
    // Everything the browser needs for Actions.accessKey.authorize(...) with the passkey account.
    return {
      limitId: limit.id,
      accessKey: { accessKeyAddress: key.accessKeyAddress, keyType: 'p256' },
      expiry: Math.floor(expiresAt.getTime() / 1000),
      limits: [
        {
          token: ALPHA_USD,
          limit: String(Math.round(body.data.amountUsd * 1e6)),
          period: PERIOD_SECONDS[body.data.period],
        },
      ],
    };
  });

  app.put('/confirm', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const body = Confirm.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const limit = await app.db.lossLimit.findFirst({
      where: { id: body.data.limitId, userId: user.id },
    });
    if (!limit) return reply.code(404).send({ error: 'limit not found' });

    // Trust the chain, not the client: tx succeeded, was sent by the user, and the key now has a limit.
    const receipt = await publicClient().getTransactionReceipt({ hash: body.data.txHash as Hex });
    if (
      receipt.status !== 'success' ||
      receipt.from.toLowerCase() !== user.tempoAddress.toLowerCase()
    )
      return reply.code(400).send({ error: 'authorization tx not valid for this user' });
    const { remaining } = await remainingLimit(
      user.tempoAddress as Address,
      limit.tempoAccessKeyId as Address,
    );
    if (remaining === 0n)
      return reply.code(400).send({ error: 'access key has no on-chain limit' });

    await app.db.lossLimit.update({
      where: { id: limit.id },
      data: { authorizedTx: body.data.txHash },
    });
    return { limitId: limit.id, remainingUsd: fromUsd(remaining) };
  });

  app.get('/', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user || reply.sent) return;
    const limit = await app.db.lossLimit.findFirst({
      where: { userId: user.id, authorizedTx: { not: null }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!limit) return { limit: null };
    const { remaining, periodEnd } = await remainingLimit(
      user.tempoAddress as Address,
      limit.tempoAccessKeyId as Address,
    );
    return {
      limit: {
        id: limit.id,
        period: limit.period,
        amountUsd: Number(limit.amountUsd),
        remainingUsd: fromUsd(remaining),
        periodEnd: periodEnd ? Number(periodEnd) : null,
        authorizedTx: limit.authorizedTx,
      },
    };
  });
};
