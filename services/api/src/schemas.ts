// PRD 11: the frozen API contract. Every schema here describes the JSON *wire* form: Prisma
// Decimals and BigInts serialize as decimal strings, Dates as ISO-8601 strings. Responses are
// validated against these (see contract.ts), and openapi.yaml + @tyr/api-client are generated
// from them — change a schema, regenerate both (`pnpm --filter @tyr/api openapi`).
import { z } from 'zod';

// ---------- primitives ----------

export const Dec = z.string().describe('decimal number as a string (exact, from Postgres numeric)');
export const IsoDate = z.string().datetime();
export const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const SideEnum = z.enum(['yes', 'no']);
export const Period = z.enum(['day', 'week']);

export const Err = z
  .object({
    error: z.string(),
    code: z.string().optional().describe('machine-readable reason (e.g. limit, balance, region)'),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('request validation failures'),
  })
  .describe('Error');

/** Error responses for the listed status codes. */
export const errors = <C extends number>(...codes: C[]) =>
  Object.fromEntries(codes.map((c) => [c, Err])) as { [K in C]: typeof Err };

const Unknown = z.unknown();

// ---------- auth / limits ----------

export const Me = z.object({
  userId: z.string(),
  tempoAddress: EvmAddress,
  region: z.string().nullable(),
});
export const AuthResult = z.object({ userId: z.string(), tempoAddress: EvmAddress });
export const WebAuthnOptions = z
  .object({ challenge: z.string() })
  .passthrough()
  .describe('PublicKeyCredential{Creation,Request}OptionsJSON — pass to @simplewebauthn/browser');
export const WebAuthnResponse = z
  .object({
    id: z.string(),
    rawId: z.string(),
    type: z.literal('public-key'),
    response: z.object({}).passthrough(),
  })
  .passthrough()
  .describe('RegistrationResponseJSON / AuthenticationResponseJSON from @simplewebauthn/browser');

export const Eligibility = z.union([
  z.object({ eligible: z.literal(true) }),
  z.object({ eligible: z.literal(false), reason: z.string() }),
]);

export const AccessKeyGrant = z
  .object({
    accessKey: z.object({ accessKeyAddress: EvmAddress, keyType: z.enum(['p256', 'secp256k1']) }),
    expiry: z.number().int().describe('unix seconds'),
    limits: z.array(
      z.object({
        token: EvmAddress,
        limit: z.string().describe('token base units (6 decimals)'),
        period: z.number().int().describe('seconds'),
      }),
    ),
  })
  .describe('Arguments for viem/tempo Actions.accessKey.authorize, signed by the passkey');

export const LimitPrepare = z.object({
  amountUsd: z.number().positive().max(10_000),
  period: Period,
});
export const LimitConfirm = z.object({ limitId: z.string(), txHash: Hex32 });
export const Limit = z.object({
  limit: z
    .object({
      id: z.string(),
      period: z.string(),
      amountUsd: z.number(),
      remainingUsd: z.number(),
      periodEnd: z.number().nullable(),
      authorizedTx: z.string().nullable(),
    })
    .nullable(),
});

// ---------- markets ----------

export const Level = z.object({ px: z.string(), sz: z.string(), n: z.number() });
export const Book = z
  .object({
    coin: z.string(),
    time: z.number(),
    levels: z.array(z.array(Level)).describe('[bids, asks]'),
  })
  .passthrough();
export const Market = z.object({
  outcome: z.number().int(),
  name: z.string(),
  description: z.string(),
  template: z.record(z.string()).nullable(),
  sides: z.array(z.string()),
  resolvesAt: IsoDate,
  yes: z.object({ coin: z.string(), bid: z.number(), ask: z.number(), mid: z.number() }),
});
export const MarketDetail = z.object({
  outcome: z
    .object({
      outcome: z.number().int(),
      name: z.string(),
      description: z.string(),
      sideSpecs: z.array(z.object({ name: z.string() }).passthrough()),
      quoteToken: z.string().optional(),
      venue: z.string().optional(),
    })
    .passthrough(),
  resolvesAt: IsoDate.nullable(),
  books: z.object({ yes: Book, no: Book }),
});
export const MarketParams = z.object({ id: z.coerce.number().int().nonnegative() });

// ---------- bets ----------

export const BetInput = z.object({
  outcome: z.number().int().nonnegative(),
  side: SideEnum,
  stakeUsd: z.number().positive().max(1_000),
  idempotencyKey: z.string().min(8).max(128),
  maxPrice: z.number().gt(0).lt(1).optional(),
});

export const Settlement = z.object({
  orderId: z.string(),
  outcome: z.string(),
  pnl: Dec,
  payoutUsd: Dec,
  payoutSalt: z.string().nullable(),
  solanaTx: z.string().nullable(),
  escrowPayTx: z.string().nullable(),
  escrowTopUpTx: z.string().nullable(),
  tempoPayoutTx: z.string().nullable(),
  memoHash: z.string().nullable(),
  closeOrderId: z.string().nullable(),
  createdAt: IsoDate,
});

export const Order = z.object({
  id: z.string(),
  userId: z.string(),
  agentSessionId: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  hlMarket: z.string().describe('outcome id'),
  side: SideEnum,
  isBuy: z.boolean(),
  tif: z.string(),
  size: Dec,
  price: Dec,
  filledSize: Dec,
  avgPx: Dec.nullable(),
  stakeUsd: Dec.nullable(),
  stakeSalt: z.string().nullable(),
  builderFee: Dec.nullable(),
  hlOid: z.string().nullable(),
  simulated: z.boolean().describe('paper fill against the live HL testnet book'),
  execution: Unknown.nullable(),
  status: z.string(),
  step: z.string().describe('last completed saga step'),
  error: z.string().nullable(),
  tempoStakeTx: z.string().nullable(),
  escrowTx: z.string().nullable(),
  solanaOpenTx: z.string().nullable(),
  parentId: z.string().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  settlement: Settlement.nullable().optional(),
});
export const IdParams = z.object({ id: z.string().min(1) });

export const Balance = z.object({ availableUsd: z.number(), token: z.literal('tyrUSD') });

// ---------- deposits ----------

export const DepositAddresses = z.object({
  evm: z.object({
    address: EvmAddress,
    chains: z.array(z.string()),
    assets: z.record(z.array(z.string())),
  }),
  solana: z.object({ owner: z.string(), usdcAta: z.string(), usdcMint: z.string() }),
  tempo: z.object({ to: EvmAddress, memo: Hex32, token: z.string() }),
});
export const Deposit = z.object({
  id: z.string(),
  userId: z.string(),
  sourceChain: z.string(),
  sourceTx: z.string(),
  logIndex: z.number().int(),
  asset: z.string(),
  amount: Dec.describe('USD credited'),
  rawAmount: z.string().nullable(),
  fxRate: Dec.nullable(),
  fxRound: z.string().nullable(),
  status: z.enum(['confirmed', 'minted', 'credited']).or(z.string()),
  mintTx: z.string().nullable(),
  solanaTx: z.string().nullable(),
  createdAt: IsoDate,
  creditedAt: IsoDate.nullable(),
});
export const DepositList = z.object({ deposits: z.array(Deposit) });
/** Claimable chains come from the configured EVM deposit sources. */
export const depositClaim = (chains: [string, ...string[]]) =>
  z.object({ chain: z.enum(chains), txHash: Hex32 });

// ---------- zcash ----------

export const ZcashRequestInput = z.object({
  outcome: z.number().int().nonnegative(),
  side: SideEnum,
  stakeUsd: z.number().positive().max(10_000),
  returnUA: z
    .string()
    .regex(/^u(1|test1|regtest1)[0-9a-z]+$/)
    .max(255),
});
export const ZcashRequest = z.object({
  uri: z.string().describe('ZIP-321 payment URI (render as QR)'),
  to: z.string(),
  zat: z.string(),
  memo: z.string(),
  zecUsd: z.number(),
});
export const TxidParams = z.object({ txid: z.string().min(1) });
export const ZcashOrder = z.object({
  id: z.string(),
  txid: z.string(),
  status: z.string(),
  marketId: z.string(),
  side: SideEnum,
  size: Dec,
  zecUsd: Dec.nullable(),
  payoutZat: z.string().nullable(),
  payoutTxid: z.string().nullable(),
  error: z.string().nullable(),
  orderId: z.string().nullable(),
});
export const ZcashDisclosure = z.object({
  kind: z.literal('zcash-ovk-view+frost'),
  receiptId: z.string(),
  orderTxid: z.string(),
  payoutTxid: z.string(),
  view: z.object({}).passthrough().nullable(),
  instruction: z.object({}).passthrough(),
  frost: z.object({
    signature: z.string(),
    signers: z.string().nullable(),
    verifyingKey: z.string(),
    threshold: z.string(),
    valid: z.boolean(),
  }),
  matches: z.boolean(),
});

// ---------- receipts ----------

export const Verification = z.object({
  receiptId: z.string(),
  kind: z.string(),
  ok: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
});
export const ReceiptSummary = z.object({
  id: z.string(),
  kind: z.enum(['bet', 'zcash-payout', 'bet+hedge']).or(z.string()),
  subjectId: z.string().nullable(),
  payloadHash: z.string(),
  visibility: z.enum(['private', 'public']),
  createdAt: IsoDate,
});
export const ReceiptDetail = ReceiptSummary.extend({ payload: Unknown });
export const ZcashReceipt = z.object({
  id: z.string(),
  payloadHash: z.string(),
  payload: Unknown,
  verification: Verification,
});
export const Proof = z.object({
  receiptId: z.string(),
  kind: z.string(),
  payloadHash: z.string(),
  provedAt: IsoDate,
  tempo: z.array(
    z.object({ label: z.string(), tx: z.string(), memo: z.string(), explorer: z.string() }),
  ),
  solana: z
    .object({
      settleTx: z.string().nullable(),
      opening: z.object({ amountUnits: z.string(), salt: z.string() }).nullable(),
      attestations: z.array(
        z.object({
          label: z.string(),
          tx: z.string(),
          explorer: z.string(),
          attestation: z.object({ statement: z.object({}).passthrough() }).passthrough(),
        }),
      ),
    })
    .nullable(),
  zcash: ZcashDisclosure.nullable(),
});
export const VisibilityInput = z.object({ visibility: z.enum(['public', 'private']) });

// ---------- hedge ----------

export const HedgeOffer = z.union([
  z.object({
    offered: z.literal(true),
    stock: z.string(),
    token: EvmAddress,
    rule: z.string(),
    yesDirection: z.enum(['buy', 'sell']),
    simulated: z.literal(true),
  }),
  z.object({ offered: z.literal(false) }),
]);
export const HedgeQuote = z.object({
  simulated: z.literal(true),
  orderId: z.string(),
  stock: z.string(),
  token: EvmAddress,
  direction: z.enum(['buy', 'sell']),
  rule: z.string(),
  amountInUsd: z.number(),
  maxAmountInUsd: z.number(),
  entryPx: z.number(),
  shares: z.number(),
  priceSource: z.string(),
  priceAt: IsoDate,
  feeBps: z.number(),
});
export const HedgeOpen = z.object({
  orderId: z.string().min(1).max(64),
  amountUsd: z.number().positive().max(1_000).optional(),
});
export const HedgeQuoteQuery = z.object({ amountUsd: z.coerce.number().positive().optional() });
export const Hedge = z.object({
  orderId: z.string(),
  userId: z.string(),
  symbol: z.string(),
  stockToken: EvmAddress,
  direction: z.enum(['buy', 'sell']),
  amountIn: Dec.describe('USD debited from the bankroll'),
  amountOut: Dec.describe('stock shares'),
  entryPx: Dec,
  exitPx: Dec.nullable(),
  valueUsd: Dec.nullable(),
  priceSource: z.string(),
  priceAt: IsoDate,
  simulated: z.boolean(),
  status: z.enum(['open', 'closed']),
  uniswapTx: z.string().nullable(),
  chainlinkRound: z.string().nullable(),
  escrowTx: z.string().nullable(),
  payTx: z.string().nullable(),
  escrowTopUpTx: z.string().nullable(),
  receiptId: z.string().nullable(),
  receiptTx: z.string().nullable(),
  createdAt: IsoDate,
  closedAt: IsoDate.nullable(),
});
export const HedgeWithReceipt = Hedge.extend({
  receipt: z
    .object({
      kind: z.literal('bet+hedge'),
      orderId: z.string(),
      bet: z.object({}).passthrough(),
      hedge: z.object({}).passthrough(),
      netPnlUsd: z.number(),
      id: z.string().nullable(),
      payloadHash: z.string().optional(),
      tempoMemoTx: z.string().nullable(),
    })
    .optional()
    .describe('combined bet payout + hedge P&L, once the hedge is closed'),
});

// ---------- agent ----------

export const AgentSessionCreate = z.object({
  agentAddress: EvmAddress,
  capUsd: z.number().positive().max(10_000),
  period: Period.default('day'),
  name: z.string().max(64).optional(),
  expiresInDays: z.number().int().min(1).max(90).default(30),
});
export const AgentSessionGrant = AccessKeyGrant.extend({ sessionId: z.string() });
export const TxConfirm = z.object({ txHash: Hex32 });
export const AgentSession = z.object({
  id: z.string(),
  name: z.string().nullable(),
  agentAddress: z.string(),
  capUsd: z.number(),
  spentUsd: z.number(),
  period: z.string(),
  expiresAt: IsoDate,
  revokedAt: IsoDate.nullable(),
  authorizedTx: z.string().nullable(),
  active: z.boolean(),
});
export const AgentSessionList = z.object({
  sessions: z.array(AgentSession.extend({ remainingUsd: z.number().nullable() })),
});
export const AgentMe = AgentSession.extend({ owner: EvmAddress, remainingUsd: z.number() });
export const MppChallenge = Unknown.describe(
  'HTTP 402 MPP challenge (WWW-Authenticate: Payment …); pay on Tempo Moderato and retry',
);

// ---------- websocket ----------

export const WsEvent = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('hello'), userId: z.string() }),
    z.object({
      type: z.literal('order'),
      userId: z.string(),
      orderId: z.string(),
      step: z.string(),
      status: z.string(),
    }),
    z.object({
      type: z.literal('settlement'),
      userId: z.string(),
      orderId: z.string(),
      outcome: z.string(),
      payoutUsd: z.number(),
    }),
    z.object({
      type: z.literal('deposit'),
      userId: z.string(),
      depositId: z.string(),
      sourceChain: z.string(),
      status: z.string(),
      amountUsd: z.number(),
    }),
  ])
  .describe('Messages pushed on GET /ws (session cookie). Closes 4401 when unauthenticated.');

/** Named schemas published under components.schemas. */
export const components = {
  Error: Err,
  Order,
  Settlement,
  Deposit,
  Market,
  MarketDetail,
  Hedge,
  ReceiptSummary,
  Verification,
  Proof,
  WsEvent,
};
