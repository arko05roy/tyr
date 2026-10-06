// PRD Phase 8 — Agent API (Flow C).
//
// Owner (passkey session) creates a capped AgentSession: the agent's secp256k1 address becomes a
// Tempo access key on the owner's account with spend limit = capUsd per period, authorized by the
// owner's passkey in the browser. The chain enforces the cap.
//
// Agent requests are signed with that key (x-tyr-agent / -timestamp / -signature). Paid routes
// answer HTTP 402 with an MPP challenge; the agent pays on Moderato through its access key, tyr
// co-signs fees, broadcasts, and checks the transfer on-chain before serving. A bet's MPP charge
// IS its Tempo stake authorization, so agent bets reuse the Flow A pipeline (`funding: prepaid`).
import type { Prisma } from '@tyr/db';
import type { Executor } from '@tyr/hyperliquid';
import { bookFor, featuredMarkets, market } from '@tyr/hyperliquid';
import { BetRejectedError, placeBet, preflightBet } from '@tyr/pipeline';
import {
  ALPHA_USD,
  PERIOD_SECONDS,
  createMpp,
  explorerTx,
  fromUsd,
  paymentTransfers,
  publicClient,
  receiptReference,
  remainingLimit,
  usd,
  verifyAgentRequest,
} from '@tyr/tempo';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Address, Hex } from 'viem';
import { z } from 'zod';
import type { TyrPlugin } from '../contract.js';
import {
  AgentMe,
  AgentSessionCreate,
  AgentSessionGrant,
  AgentSessionList,
  BetInput,
  IdParams,
  Market,
  MarketDetail,
  MarketParams,
  MppChallenge,
  Order,
  TxConfirm,
  errors,
  Book,
} from '../schemas.js';
import { authUser, userOf } from './session.js';

/** Price of one paid data / evidence call, in USD (AlphaUSD). */
export const DATA_PRICE_USD = 0.01;

const STATUS = { market: 400, size: 400, balance: 409, limit: 402 } as const;

const owner = { preValidation: authUser };
const ownerTags = ['agent sessions'];
const ownerSecurity = [{ session: [] }];
const agentTags = ['agent'];
const agentSecurity = [{ agent: [] }];
/** Agent auth failures, plus the 402 MPP challenge on paid routes. */
const agentErrors = errors(401, 403);
const paid = { 402: MppChallenge };

/** MPP wants a decimal amount string in token units. */
const amountString = (n: number) => String(Number(n.toFixed(6)));

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    agent?: AgentSessionRow;
  }
}

type AgentSessionRow = Prisma.AgentSessionGetPayload<{ include: { owner: true } }>;

export const agentRoutes =
  (exec: Executor): TyrPlugin =>
  async (app) => {
    const mpp = createMpp();

    // Keep the exact body bytes: agent signatures cover sha256(body).
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      req.rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    // ---------- owner side (passkey session) ----------

    app.post(
      '/sessions',
      {
        ...owner,
        schema: {
          tags: ownerTags,
          security: ownerSecurity,
          description:
            'Register an agent key with a spend cap; the passkey then authorizes it on-chain.',
          body: AgentSessionCreate,
          response: { 201: AgentSessionGrant, ...errors(400, 401, 409) },
        },
      },
      async (req, reply) => {
        const user = userOf(req);
        const body = { data: req.body };
        const agentAddress = body.data.agentAddress.toLowerCase();
        if (await app.db.agentSession.findUnique({ where: { agentPubkey: agentAddress } }))
          return reply.code(409).send({ error: 'agent key already registered' });

        const expiresAt = new Date(Date.now() + body.data.expiresInDays * 86_400_000);
        const s = await app.db.agentSession.create({
          data: {
            ownerId: user.id,
            agentPubkey: agentAddress,
            capUsd: body.data.capUsd,
            period: body.data.period,
            name: body.data.name ?? null,
            expiresAt,
          },
        });
        // Everything the browser needs for Actions.accessKey.authorize(...) with the passkey.
        return reply.code(201).send({
          sessionId: s.id,
          accessKey: { accessKeyAddress: body.data.agentAddress, keyType: 'secp256k1' },
          expiry: Math.floor(expiresAt.getTime() / 1000),
          limits: [
            {
              token: ALPHA_USD,
              limit: usd(body.data.capUsd).toString(),
              period: PERIOD_SECONDS[body.data.period],
            },
          ],
        });
      },
    );

    app.put(
      '/sessions/:id/confirm',
      {
        ...owner,
        schema: {
          tags: ownerTags,
          security: ownerSecurity,
          params: IdParams,
          body: TxConfirm,
          response: {
            200: z.object({ sessionId: z.string(), remainingUsd: z.number() }),
            ...errors(400, 401, 404),
          },
        },
      },
      async (req, reply) => {
        const user = userOf(req);
        const p = req.params;
        const body = { data: req.body };
        const s = await app.db.agentSession.findFirst({ where: { id: p.id, ownerId: user.id } });
        if (!s) return reply.code(404).send({ error: 'session not found' });

        // Trust the chain: the owner sent the authorization and the key now carries a limit.
        const receipt = await publicClient().getTransactionReceipt({
          hash: body.data.txHash as Hex,
        });
        if (
          receipt.status !== 'success' ||
          receipt.from.toLowerCase() !== user.tempoAddress.toLowerCase()
        )
          return reply.code(400).send({ error: 'authorization tx not valid for this owner' });
        const { remaining } = await remainingLimit(
          user.tempoAddress as Address,
          s.agentPubkey as Address,
        );
        if (remaining === 0n)
          return reply.code(400).send({ error: 'agent key has no on-chain limit' });
        await app.db.agentSession.update({
          where: { id: s.id },
          data: { tempoSessionId: body.data.txHash },
        });
        return { sessionId: s.id, remainingUsd: fromUsd(remaining) };
      },
    );

    app.get(
      '/sessions',
      {
        ...owner,
        schema: {
          tags: ownerTags,
          security: ownerSecurity,
          response: { 200: AgentSessionList, ...errors(401) },
        },
      },
      async (req) => {
        const user = userOf(req);
        const sessions = await app.db.agentSession.findMany({
          where: { ownerId: user.id },
          orderBy: { createdAt: 'desc' },
        });
        return {
          sessions: await Promise.all(
            sessions.map(async (s) => ({
              ...sessionView(s),
              remainingUsd: s.tempoSessionId
                ? fromUsd(
                    (await remainingLimit(user.tempoAddress as Address, s.agentPubkey as Address))
                      .remaining,
                  )
                : null,
            })),
          ),
        };
      },
    );

    /** Stops tyr serving the agent. The on-chain key is revoked by the owner's passkey. */
    app.delete(
      '/sessions/:id',
      {
        ...owner,
        schema: {
          tags: ownerTags,
          security: ownerSecurity,
          description: 'Stops tyr serving the agent; revoke the on-chain key with the passkey.',
          params: IdParams,
          response: {
            200: z.object({ sessionId: z.string(), revoked: z.literal(true) }),
            ...errors(401, 404),
          },
        },
      },
      async (req, reply) => {
        const user = userOf(req);
        const p = req.params;
        const r = await app.db.agentSession.updateMany({
          where: { id: p.id, ownerId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (r.count === 0) return reply.code(404).send({ error: 'session not found' });
        return { sessionId: p.id, revoked: true as const };
      },
    );

    // ---------- agent side (signed requests) ----------

    /** preValidation hook: verifies the request signature and the agent's live session. */
    async function authAgent(req: FastifyRequest, reply: FastifyReply) {
      const addr = await verifyAgentRequest({
        method: req.method,
        path: req.url,
        body: req.rawBody ?? '',
        headers: req.headers,
      });
      if (!addr) return reply.code(401).send({ error: 'bad agent signature' });
      const s = await app.db.agentSession.findUnique({
        where: { agentPubkey: addr.toLowerCase() },
        include: { owner: true },
      });
      if (!s || !s.tempoSessionId || s.revokedAt || s.expiresAt < new Date())
        return reply.code(403).send({ error: 'no active agent session for this key' });
      req.agent = s;
    }
    const agentOf = (req: FastifyRequest) => {
      if (!req.agent) throw new Error('route is missing the authAgent hook');
      return req.agent;
    };
    const agent = { preValidation: authAgent };

    /**
     * Run the MPP charge. Sends the 402 challenge (or failed-payment 402) and returns null, or
     * returns the verified payment tx + the Payment-Receipt header to attach to the response.
     */
    async function charge(
      req: FastifyRequest,
      reply: FastifyReply,
      s: AgentSessionRow,
      p: { amountUsd: number; kind: string; resource: string; description: string },
    ) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
        method: req.method,
        headers,
        ...(req.rawBody ? { body: req.rawBody } : {}),
      });
      const r = await mpp.charge({ amount: amountString(p.amountUsd), description: p.description })(
        request,
      );
      if (r.status === 402) {
        const c = r.challenge;
        c.headers.forEach((v, k) => void reply.header(k, v));
        reply.code(402).send(await c.text());
        return null;
      }
      const tagged = await r.withReceipt(new Response(null));
      const hash = receiptReference(tagged);
      const paid = (await paymentTransfers(hash))
        .filter((t) => t.from.toLowerCase() === s.owner.tempoAddress.toLowerCase())
        .reduce((a, t) => a + t.amount, 0n);
      if (paid < usd(p.amountUsd)) {
        reply.code(402).send({ error: 'payment did not come from this agent session', tx: hash });
        return null;
      }
      await app.db.$transaction([
        app.db.agentCharge.create({
          data: {
            sessionId: s.id,
            kind: p.kind,
            resource: p.resource,
            amountUsd: p.amountUsd,
            txHash: hash,
          },
        }),
        app.db.agentSession.update({
          where: { id: s.id },
          data: { spentUsd: { increment: p.amountUsd } },
        }),
      ]);
      reply.header('payment-receipt', tagged.headers.get('payment-receipt') ?? '');
      return { hash };
    }

    app.get(
      '/me',
      {
        ...agent,
        schema: {
          tags: agentTags,
          security: agentSecurity,
          response: { 200: AgentMe, ...agentErrors },
        },
      },
      async (req) => {
        const s = agentOf(req);
        const { remaining } = await remainingLimit(
          s.owner.tempoAddress as Address,
          s.agentPubkey as Address,
        );
        return { ...sessionView(s), owner: s.owner.tempoAddress, remainingUsd: fromUsd(remaining) };
      },
    );

    app.get(
      '/markets',
      {
        ...agent,
        schema: {
          tags: agentTags,
          security: agentSecurity,
          response: {
            200: z.object({
              markets: z.array(Market),
              priceUsd: z.object({ data: z.number() }),
            }),
            ...agentErrors,
          },
        },
      },
      async () => ({ markets: await featuredMarkets(), priceUsd: { data: DATA_PRICE_USD } }),
    );

    // Paid: full two-sided books for one outcome market.
    app.get(
      '/markets/:id/data',
      {
        ...agent,
        schema: {
          tags: agentTags,
          security: agentSecurity,
          description: `Paid ($${DATA_PRICE_USD}): full two-sided books for one outcome market.`,
          params: MarketParams,
          response: {
            200: z.object({
              market: MarketDetail,
              books: z.object({ yes: Book, no: Book }),
              paymentTx: z.string(),
            }),
            ...paid,
            ...errors(400, 401, 403, 404),
          },
        },
      },
      async (req, reply) => {
        const s = agentOf(req);
        const p = { data: req.params };
        const m = await market(p.data.id);
        if (!m) return reply.code(404).send({ error: 'unknown outcome' });
        const paid = await charge(req, reply, s, {
          amountUsd: DATA_PRICE_USD,
          kind: 'data',
          resource: `market:${p.data.id}`,
          description: `tyr market data #${p.data.id}`,
        });
        if (!paid) return;
        const [yes, no] = await Promise.all([bookFor(p.data.id, 0), bookFor(p.data.id, 1)]);
        return { market: m, books: { yes, no }, paymentTx: paid.hash };
      },
    );

    // Paid: on-chain evidence trail for one of this agent's bets.
    app.get(
      '/evidence/:id',
      {
        ...agent,
        schema: {
          tags: agentTags,
          security: agentSecurity,
          description: `Paid ($${DATA_PRICE_USD}): on-chain evidence trail for one of this agent's bets.`,
          params: IdParams,
          response: {
            200: z.object({
              order: Order,
              links: z.object({
                tempoStake: z.string().nullable(),
                tempoPayout: z.string().nullable(),
              }),
              paymentTx: z.string(),
            }),
            ...paid,
            ...errors(401, 403, 404),
          },
        },
      },
      async (req, reply) => {
        const s = agentOf(req);
        const p = req.params;
        const order = await app.db.order.findFirst({
          where: { id: p.id, agentSessionId: s.id },
          include: { settlement: true },
        });
        if (!order) return reply.code(404).send({ error: 'not found' });
        const paid = await charge(req, reply, s, {
          amountUsd: DATA_PRICE_USD,
          kind: 'evidence',
          resource: `order:${order.id}`,
          description: `tyr evidence ${order.id}`,
        });
        if (!paid) return;
        return {
          order,
          links: {
            tempoStake: order.tempoStakeTx ? explorerTx(order.tempoStakeTx as Hex) : null,
            tempoPayout: order.settlement?.tempoPayoutTx
              ? explorerTx(order.settlement.tempoPayoutTx as Hex)
              : null,
          },
          paymentTx: paid.hash,
        };
      },
    );

    // Paid: the MPP charge is the stake (capped on-chain), then the Flow A pipeline runs.
    app.post(
      '/bets',
      {
        ...agent,
        schema: {
          tags: agentTags,
          security: agentSecurity,
          description:
            'Paid: the MPP charge (= stake) is capped on-chain by the session, then Flow A runs. ' +
            'Replaying an idempotencyKey returns the same order (200) without a new charge.',
          body: BetInput,
          response: {
            200: Order,
            201: Order,
            ...paid,
            ...errors(400, 401, 403, 409),
          },
        },
      },
      async (req, reply) => {
        const s = agentOf(req);
        const input = { userId: s.ownerId, agentSessionId: s.id, ...req.body };

        const existing = await app.db.order.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing && existing.agentSessionId !== s.id)
          return reply.code(409).send({ error: 'idempotency key already used' });
        try {
          let stakeTx = existing?.tempoStakeTx ?? undefined;
          if (!existing) {
            await preflightBet(app.db, input); // never charge for a bet the pipeline would reject
            const paid = await charge(req, reply, s, {
              amountUsd: input.stakeUsd,
              kind: 'bet',
              resource: `bet:${input.idempotencyKey}`,
              description: `tyr stake ${input.stakeUsd} USD on #${input.outcome} ${input.side}`,
            });
            if (!paid) return;
            stakeTx = paid.hash;
          }
          const order = await placeBet(app.db, exec, { ...input, funding: 'prepaid', stakeTx });
          return reply.code(existing ? 200 : 201).send(order);
        } catch (err) {
          if (err instanceof BetRejectedError)
            return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code });
          throw err;
        }
      },
    );

    app.get(
      '/bets/:id',
      {
        ...agent,
        schema: {
          tags: agentTags,
          security: agentSecurity,
          params: IdParams,
          response: { 200: Order, ...errors(401, 403, 404) },
        },
      },
      async (req, reply) => {
        const s = agentOf(req);
        const p = req.params;
        const order = await app.db.order.findFirst({
          where: { id: p.id, agentSessionId: s.id },
          include: { settlement: true },
        });
        if (!order) return reply.code(404).send({ error: 'not found' });
        return order;
      },
    );
  };

function sessionView(s: {
  id: string;
  name: string | null;
  agentPubkey: string;
  capUsd: unknown;
  spentUsd: unknown;
  period: string;
  expiresAt: Date;
  revokedAt: Date | null;
  tempoSessionId: string | null;
}) {
  return {
    id: s.id,
    name: s.name,
    agentAddress: s.agentPubkey,
    capUsd: Number(s.capUsd),
    spentUsd: Number(s.spentUsd),
    period: s.period,
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt,
    authorizedTx: s.tempoSessionId,
    active: !!s.tempoSessionId && !s.revokedAt && s.expiresAt > new Date(),
  };
}
