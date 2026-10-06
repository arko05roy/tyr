// PRD 6 / 11: per-chain deposit addresses, deposit history, and claim-by-tx-hash for EVM deposits
// (required for ETH, optional fast path for USDC). The funding worker credits what's recorded.
import {
  DepositClaimError,
  claimEvmDeposit,
  creditDeposit,
  depositAddresses,
  evmSources,
} from '@tyr/evm-deposits';
import type { TyrPlugin } from '../contract.js';
import { DepositAddresses, DepositList, depositClaim, errors } from '../schemas.js';
import { authUser, userOf } from './session.js';

const STATUS = { not_found: 404, pending: 409, failed: 422, no_deposit: 422 } as const;
const route = { preValidation: authUser };
const tags = ['deposits'];
const security = [{ session: [] }];

export const depositRoutes: TyrPlugin = async (app) => {
  const Claim = depositClaim(Object.keys(evmSources()) as [string, ...string[]]);

  app.get(
    '/addresses',
    {
      ...route,
      schema: { tags, security, response: { 200: DepositAddresses, ...errors(401) } },
    },
    async (req) => depositAddresses(app.db, userOf(req).id),
  );

  app.get(
    '/',
    { ...route, schema: { tags, security, response: { 200: DepositList, ...errors(401) } } },
    async (req) => ({
      deposits: await app.db.deposit.findMany({
        where: { userId: userOf(req).id },
        orderBy: { createdAt: 'desc' },
      }),
    }),
  );

  app.post(
    '/claim',
    {
      ...route,
      schema: {
        tags,
        security,
        description:
          'Claim an EVM deposit by tx hash (required for ETH). Credits inline when possible; ' +
          'the funding worker retries anything left uncredited.',
        body: Claim,
        response: { 201: DepositList, ...errors(400, 401, 404, 409, 422) },
      },
    },
    async (req, reply) => {
      try {
        const recorded = await claimEvmDeposit(
          app.db,
          userOf(req).id,
          req.body.chain as keyof ReturnType<typeof evmSources>,
          req.body.txHash as `0x${string}`,
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
    },
  );
};
