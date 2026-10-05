# tyr.bet — Technical PRD (Testnet-First Build Plan)

> Source: `idea.md` (2026-10-04). Product renamed from "Veil" to **tyr.bet**.
> Deadline: **Oct 12, 2026, 11:59pm PT**. Scope freeze: Oct 11.
> Audience: the builder (you), coding this step by step.

## Progress (updated 2026-10-05)

| Phase                    | Status                      | Notes                                                                                            |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ |
| 0 — Repo, config, guards | ✅ Done                     | Guard test green on live RPCs; Sepolia/Base/Arb RPCs optional until Phase 6                      |
| 1 — Spikes               | ✅ Done (3 with deviations) | S1 ✅ live · S2 ⚠️ local regtest · S3 ✅ live · S4 ⚠️ execution simulated · S5 ⚠️ swap simulated |
| 2 — Tempo backend        | ✅ Done                     | 9/9 live tests green (guard + tempo + API); hashes in `docs/evidence.md`                         |
| 3 — Solana               | ⏭ Next                      | 🛑 Stop 3: auditor-key decision + program deploy key                                             |
| 4–13                     | ⬜ Not started              |                                                                                                  |

**Owner-approved deviations** (details + reasons in `docs/human-values.md` → Decisions):

- **Hyperliquid execution simulated** — paper fills against the live HL testnet book (`simulated: true`, no fake oids/hashes). Testnet USDC needs an HL-mainnet-history address (drip and Circle CCTP both enforce it). Builder-fee proof deferred.
- **Robinhood hedge swap simulated** — real RH testnet Stock Tokens + balances; price from HL testnet `xyz` mids (no official Chainlink feed / Uniswap pool on RH testnet).
- **Zcash on local regtest** (`infra/zcash-regtest`, zebrad 6.3.0 + zainod 0.10.1) — no reachable TAZ faucet. Shielded pool on this chain is Ironwood (Orchard's successor).

---

## 0. Ground rules (apply to every phase)

1. **Testnet only.** Every chain runs on its public testnet. No mainnet RPC URL, key, or address may appear anywhere in the repo. A startup guard (Phase 0.4) refuses to boot if a known mainnet chain ID / genesis hash is detected.
2. **Nothing mocked.** No mock servers, no stubbed SDKs, no fake tx hashes, no `if (TEST) return fakeResult`. Tests hit the real testnets. If an integration can't work on testnet, the plan says so explicitly and replaces it with a _real_ alternative (see §0.3) — never a fake.
3. **Order of work:** backend → backend tests (live testnet) → backend exposes REST/WebSocket APIs → frontend (Next.js + TypeScript) integrates those APIs. The frontend never talks to a chain except where a user signature is required (passkey, Phantom).
4. **Tests gate each phase.** A phase is done only when its integration test suite passes against the live testnet and the resulting tx hashes are logged in `docs/evidence.md`.
5. **🛑 HUMAN STOP points** are marked throughout. At each one, stop coding, ask the human for the listed value, and record where it came from. Never invent addresses, keys, chain IDs, or market IDs.

### 0.1 Networks used

| Chain           | Testnet                                            | Notes                                      |
| --------------- | -------------------------------------------------- | ------------------------------------------ |
| Tempo           | Moderato testnet                                   | Faucet on tempo.xyz/developers             |
| Solana          | Devnet                                             | Token-2022 Confidential Transfer extension |
| Zcash           | Zcash testnet (TAZ)                                | Orchard shielded pool, via lightwalletd    |
| Hyperliquid     | Hyperliquid testnet (HyperCore + HyperEVM testnet) | `api.hyperliquid-testnet.xyz`              |
| Robinhood Chain | Robinhood Chain testnet                            | Simulated Stock Tokens, test ETH           |
| Base            | Base Sepolia                                       | deposit source                             |
| Arbitrum        | Arbitrum Sepolia                                   | deposit source                             |
| Ethereum        | Sepolia                                            | deposit source                             |

### 0.2 Known testnet realities (verify in spikes, don't assume)

- **NEAR Intents / SwapKit do not route between testnets.** Cross-chain funding on testnet is therefore done by **tyr's own deposit relayer** (real on-chain txs on both sides: lock/receive on the source testnet, release on Solana devnet). This is a real integration, not a mock; it is the honest testnet equivalent of an intents route. Document it in the README.
- **There is no Tempo ↔ Solana bridge on testnet.** Same pattern: tyr treasury wallets on both chains + relayer that reconciles with memos.
- **Hyperliquid testnet USDC is separate from Solana devnet funds.** tyr runs a testnet "venue float" on Hyperliquid testnet; the user's Solana confidential balance is debited (real tx) and the float places the order (real order) on their sub-account. Explain this in the demo.
- **Confidential Transfer on devnet:** the ZK ElGamal Proof program must be enabled on devnet. Spike S1 confirms this on day one. If it is disabled, 🛑 stop and tell the human (fallback: run a `solana-test-validator`/Surfpool with the feature active is _not_ acceptable as "testnet" without the human's approval).
- **HIP-4 outcome markets on testnet:** confirm they exist on testnet in spike S4. If not, 🛑 stop — options are (a) trade HIP-4 on testnet if any exist, (b) human approves using regular testnet perp/spot markets as the execution leg while keeping outcome-market UI read-only from mainnet _info_ endpoints (read-only data is not a mainnet integration, but needs explicit human sign-off).

### 0.3 What "real" means per integration

| Integration                               | Real on testnet via                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Passkey account, sponsored fees, batching | Tempo Moderato, WebAuthn in the browser                                               |
| Loss limit / spend cap                    | Tempo access-key spend limits / MPP session on Moderato                               |
| Memo receipts, payouts                    | TIP-20 `transferWithMemo` on Moderato (pathUSD / faucet stablecoin)                   |
| Shielded order                            | Real TAZ shielded tx with 512-byte memo, scanned by tyr's viewing key                 |
| Threshold custody                         | FROST (ZF `frost` RedPallas) 2-of-3 signing of real testnet spends                    |
| Hidden bankroll                           | Token-2022 confidential mint on devnet, real proofs                                   |
| Bets                                      | Real orders on Hyperliquid testnet with tyr's builder code                            |
| Hedge                                     | Real Uniswap swap on Robinhood Chain testnet + real Chainlink feed read               |
| Deposits                                  | Real ERC-20/ETH transfers on Base Sepolia / Arb Sepolia / Sepolia, real SPL on devnet |

---

## 1. Architecture

```
apps/
  web/                 Next.js 15 (App Router) + TypeScript — frontend only
services/
  api/                 Fastify + TypeScript — REST + WS, auth, orchestration
  workers/             BullMQ workers: deposit watcher, zcash scanner, settlement, payouts
packages/
  core/                shared types, zod schemas, config loader, testnet guard
  tempo/               Tempo client (viem + tempo extensions)
  solana/              Token-2022 confidential ops + Anchor client
  zcash/               lightwalletd client, memo codec, ZIP-321, FROST coordinator
  hyperliquid/         HL testnet trading adapter (signing, builder code)
  robinhood/           Uniswap swap adapter, Chainlink reader, geofence
  evm-deposits/        Base/Arb/Sepolia deposit watchers
programs/
  tyr_settlement/      Anchor program (Solana devnet)
infra/
  docker-compose.yml   Postgres 16, Redis 7, zcashd/zebrad-free (uses public lightwalletd)
docs/
  evidence.md          tx hashes per test run
  human-values.md      every value the human supplied + its source
```

**Stack:** pnpm workspaces, Node 22, TypeScript strict, Fastify, Prisma + Postgres, Redis + BullMQ, viem, `@solana/kit` + `@solana/spl-token` (Token-2022) + Anchor 0.31, `@nktkas/hyperliquid` (or direct signed HTTP), Rust for the Zcash/FROST sidecar (`zcash_client_backend`, `frost-redpallas`) exposed over a local gRPC/HTTP interface, Vitest for TS tests, `anchor test` against devnet for the program.

### 1.1 Core data model (Prisma)

- `User` (id, tempoAddress, passkeyCredentialId, region, createdAt)
- `LossLimit` (userId, period: day|week, amountUsd, tempoAccessKeyId, expiresAt)
- `ConfidentialAccount` (userId, solanaTokenAccount, elgamalPubkey, aeKeyRef)
- `Deposit` (id, userId, sourceChain, sourceTx, amount, status, solanaTx)
- `ZcashOrder` (id, txid, memoRaw, marketId, side, size, returnAddr, status)
- `Order` (id, userId, hlMarket, side, size, price, hlOid, builderFee, status)
- `Settlement` (orderId, outcome, pnl, solanaTx, tempoPayoutTx, memoHash)
- `Hedge` (orderId, stockToken, amountIn, amountOut, uniswapTx, chainlinkRound)
- `AgentSession` (id, ownerId, agentPubkey, capUsd, spentUsd, tempoSessionId)
- `Receipt` (id, kind, payloadHash, proofRef, visibility)

---

## Phase 0 — Repo, config, guards (½ day) — ✅ DONE

✅ **0.1** Init pnpm monorepo per §1, strict tsconfig, ESLint, Prettier, Vitest, Husky.
✅ **0.2** `packages/core/config.ts`: zod-validated env. App refuses to start on any missing var.
✅ **0.3** `infra/docker-compose.yml`: Postgres + Redis. Prisma schema from §1.1, first migration.
✅ **0.4** **Testnet guard**: on boot, query each RPC's chain ID / genesis hash and assert it equals the testnet value in config. Hard-fail otherwise.
✅ **0.5** `.env.example` listing every var below with a comment pointing to its source.

🛑 **HUMAN STOP 0 — RPC endpoints & infra** ✅ resolved

| Value                                                | Where to get it                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TEMPO_RPC_URL`, `TEMPO_CHAIN_ID`                    | tempo.xyz/developers → Moderato testnet network details                                                |
| `SOLANA_RPC_URL` (devnet)                            | Helius dashboard (helius.dev) free devnet key, or `https://api.devnet.solana.com` (rate-limited)       |
| `ZCASH_LIGHTWALLETD_URL` (testnet)                   | Zcash community lightwalletd testnet endpoint list (zechub.wiki / zcash docs)                          |
| `HL_API_URL`                                         | Hyperliquid docs → testnet API (`https://api.hyperliquid-testnet.xyz`) — confirm                       |
| `ROBINHOOD_RPC_URL`, `ROBINHOOD_CHAIN_ID`            | docs.robinhood.com/chain → testnet network page (do **not** use 4663 unless docs say it's the testnet) |
| `BASE_SEPOLIA_RPC`, `ARB_SEPOLIA_RPC`, `SEPOLIA_RPC` | Alchemy dashboard (alchemy.com) — create one app per network                                           |
| `DATABASE_URL`, `REDIS_URL`                          | local docker-compose (no human needed) or Railway if deploying                                         |

**Tests (Phase 0):** `core.guard.test.ts` — connects to every RPC, asserts testnet chain IDs, fails on mismatch.

---

## Phase 1 — Spikes (Oct 4–6). Each is a real script + a real test. — ✅ DONE (with deviations)

Each spike lives in `spikes/sN-*/` and becomes the seed of its package. If a spike fails, 🛑 stop and report before building on it.

| Spike | Proves                                        | Pass criterion                                                                                                                  |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ✅ S1 | Confidential transfer on Solana devnet        | Create CT mint, configure account, deposit → apply pending → confidential transfer → withdraw; explorer shows encrypted amounts |
| ⚠️ S2 | Zcash memo round trip                         | Send shielded TAZ with JSON memo to tyr UA; scanner decrypts memo with IVK within 3 blocks                                      |
| ✅ S3 | Tempo passkey + sponsored batch + spend limit | Passkey-created account sends a batched sponsored tx; a transfer exceeding the access-key limit is rejected on-chain            |
| ⚠️ S4 | Hyperliquid builder-code order                | Place + cancel an order on HL testnet with builder `{b, f}`; fill shows builder fee; list tradable outcome markets              |
| ⚠️ S5 | Robinhood Chain hedge                         | Read Chainlink `latestRoundData` for a test Stock Token; quote + execute a Uniswap swap on testnet                              |

**Spike results (2026-10-05):**

- ✅ **S1** — passed on devnet (needs `spl-token-cli` ≥ 5.6.1; 5.5.0 proofs are rejected). ZK ElGamal program **is active** on devnet. Mint `75GVnVC64Pw5SuR3ADMHPQCQGbCoLP55khEsL2cLvbX7`.
- ⚠️ **S2** — passed on **local regtest**, not TAZ testnet; memo decrypted after 1 block. `spikes/s2-zcash/`.
- ✅ **S3** — passed on Moderato; over-limit spend → `SpendingLimitExceeded`.
- ⚠️ **S4** — HIP-4 outcome markets **exist on testnet** (632; asset = `100_000_000 + 10·outcome + side`). Order/cancel/builder-fee **not run** (no testnet USDC); paper execution against the live book instead.
- ⚠️ **S5** — real Stock Tokens on RH testnet; Chainlink read + Uniswap swap **simulated** (no official testnet deployments found).

🛑 **HUMAN STOP 1 — funded testnet wallets** ✅ resolved (wallets generated; see `docs/human-values.md`) (needed before spikes run)

| Value                                                             | Where to get it                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOLANA_TREASURY_KEYPAIR` (devnet)                                | `solana-keygen new`; fund via faucet.solana.com                                                                                                                                                                                   |
| `TEMPO_SPONSOR_PRIVATE_KEY` + funded with testnet stablecoin      | generate with `cast wallet new`; fund via Tempo Moderato faucet (tempo.xyz/developers)                                                                                                                                            |
| `ZCASH_TESTNET_SEED` (tyr wallet) + TAZ                           | generate with Zingo/Ywallet in testnet mode; fund via the Zcash testnet faucet (search "TAZ faucet" on zechub.wiki)                                                                                                               |
| A second funded Zcash testnet wallet (acts as the "user")         | same as above                                                                                                                                                                                                                     |
| `HL_MASTER_PRIVATE_KEY`, `HL_AGENT_PRIVATE_KEY`                   | Create wallet; claim testnet USDC at app.hyperliquid-testnet.xyz/drip (requires the address to have a mainnet deposit history — **ask the human**; the drip has eligibility rules). Approve an API/agent wallet in the testnet UI |
| `ROBINHOOD_HOT_WALLET_KEY` + test ETH + simulated Stock Tokens    | Robinhood Chain testnet faucet per docs.robinhood.com/chain                                                                                                                                                                       |
| `EVM_DEPOSIT_RECEIVER_KEY` + Sepolia/Base Sepolia/Arb Sepolia ETH | Alchemy / Google Cloud / QuickNode Sepolia faucets; Base & Arb Sepolia faucets or bridge from Sepolia                                                                                                                             |

Record every value (public parts only) in `docs/human-values.md`. Private keys go to `.env` / a secrets manager only.

---

## Phase 2 — Tempo: accounts, loss limits, payouts (backend) — ✅ DONE

**Package:** `packages/tempo`

✅ 2.1 **Passkey registration flow (server side):** issue WebAuthn challenges (`@simplewebauthn/server`), store credential ID + public key, derive Tempo account address per Tempo's passkey account scheme (read tempo.xyz/developers → Tempo Transactions / passkeys).
✅ 2.2 **Fee sponsorship:** API endpoint co-signs user tx as fee payer using `TEMPO_SPONSOR_PRIVATE_KEY`. Rate-limit per user.
✅ 2.3 **Batched tx builder:** helper that bundles calls (e.g. approve + transfer + memo) into one Tempo transaction.
✅ 2.4 **Loss limit:** create an access key / MPP session for the user's account with a per-period spend limit on the stablecoin. tyr's backend holds the session key; every bet debits through it. The chain enforces the cap — the backend does not.
✅ 2.5 **Payouts:** `transferWithMemo(to, amount, memo32)` where `memo32 = keccak256(settlementId)` truncated to 32 bytes. Store mapping memo → settlement.
✅ 2.6 **Receipt indexer:** worker subscribes to TIP-20 `TransferWithMemo` events for tyr's addresses.

🛑 **HUMAN STOP 2** ✅ resolved with defaults (AlphaUSD, `localhost`)

| Value                                                    | Where to get it                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Testnet stablecoin address(es) (pathUSD / AlphaUSD etc.) | tempo.xyz/developers → testnet token list                           |
| Account-keychain / access-key precompile address & ABI   | Tempo docs → Tempo Transactions / Account Keychain                  |
| MPP session spec details (if using MPP over HTTP 402)    | agents.tempo.xyz + MPP spec linked from tempo.xyz/developers        |
| `WEBAUTHN_RP_ID` / origin                                | the human decides the domain (`localhost` for dev, `tyr.bet` later) |

**Tests (live Moderato):**

- `tempo.passkey.test.ts`: register a virtual WebAuthn authenticator (software key via `@simplewebauthn` test authenticator — this is a real P-256 signature, not a mock), create account, send sponsored tx; assert receipt status = success and user's fee balance unchanged.
- `tempo.limit.test.ts`: set $5 limit; spend $4 ✅; spend $2 ❌ (tx reverts on-chain); assert revert reason.
- `tempo.payout.test.ts`: payout with memo; indexer picks up the event; memo maps back to settlement.

---

## Phase 3 — Solana: confidential bankroll + settlement program — ⏭ NEXT

**Package:** `packages/solana`, **Program:** `programs/tyr_settlement`

3.1 **Mint:** create Token-2022 mint `tyrUSD` (6 decimals) with ConfidentialTransferMint extension, auditor ElGamal pubkey = tyr compliance key (optional, for the "prove" feature).
3.2 **Per-user confidential account:** create ATA, `configureAccount` with user ElGamal + AE keys. **Key custody decision:** for hackathon scope, keys are derived server-side from a per-user secret encrypted with KMS/age, _or_ client-side from a passkey PRF output. Default: server-side derived (proofs generated in Node via the ZK SDK wasm); browser proving is a stretch.
3.3 **Ops:** `deposit` (public → pending), `applyPendingBalance`, `confidentialTransfer` (user → tyr escrow), `withdraw`. Proof generation uses the official Solana ZK ElGamal SDK; split-proof context-state accounts for transfers.
3.4 **Anchor program `tyr_settlement`:** accounts `Market`, `Position` (PDA per user+order), `Config` (admin, relayer pubkey). Instructions:

- `open_position(order_id, market_id, side, size_commitment)` — records order linkage (no plaintext size).
- `settle_position(order_id, outcome, payout_commitment)` — relayer-signed; marks settled; emits event consumed by payout worker.
- `set_relayer`, `pause`.
  Confidential token movement is done via Token-2022 CPI-free instructions in the same tx (CT instructions are client-assembled), linked by order_id.
  3.5 **Auditor decrypt endpoint** (for "prove a payout"): decrypt a transfer amount with the auditor key and return a signed attestation.

🛑 **HUMAN STOP 3**

| Value                                                         | Where to get it                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Confirmation the ZK ElGamal Proof program is active on devnet | Spike S1 result; solana.com/docs/finance/privacy; ask in Solana StackExchange/Discord if unclear |
| Program deploy authority keypair (devnet)                     | `solana-keygen new`, human keeps the file; fund ~5 devnet SOL                                    |
| Whether auditor key is enabled (privacy tradeoff)             | human product decision                                                                           |

**Tests (live devnet):**

- `anchor test --provider.cluster devnet`: init config, open, settle, unauthorized settle fails, pause blocks.
- `solana.ct.test.ts`: full deposit → apply → transfer → withdraw; fetch account and assert balance field is ciphertext (no plaintext amount in account data); decrypt with owner AE key equals expected.
- `solana.auditor.test.ts`: auditor decrypts a transfer amount; cannot decrypt available balance.

---

## Phase 4 — Hyperliquid: execution + builder fee

**Package:** `packages/hyperliquid`

4.1 **Info client:** `meta`, `spotMeta`, outcome-market listing (HIP-4 info endpoint — read official docs), L2 book, user fills, order status, via `POST /info`.
4.2 **Exchange client:** EIP-712 signing with the approved agent key; `order` with `builder: { b: TYR_BUILDER_ADDRESS, f: feeTenthsBps }`; `cancel`; `approveBuilderFee` signed by the master key (one-time per user/sub-account).
4.3 **Account model:** one HL testnet sub-account per tyr user (or a pooled float with internal ledger — pick sub-accounts if testnet allows creation; else pooled). Funding moves from the HL float, matched 1:1 to the user's Solana confidential debit.
4.4 **Fill & resolution watcher:** WS `userFills` and `orderUpdates`; on market resolution enqueue settlement (Phase 5).
4.5 **Builder fee accounting:** read builder fee earned via `referral`/builder info endpoint; expose `/api/admin/revenue`.

🛑 **HUMAN STOP 4**

| Value                                      | Where to get it                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TYR_BUILDER_ADDRESS`                      | human-controlled EVM address; must hold the minimum USDC in its HL testnet perps account required for builder codes (read Hyperliquid docs → Builder codes) |
| Builder fee rate (`f`)                     | human business decision, within the max allowed in HL docs (perps vs spot/outcome limits differ)                                                            |
| List of testnet outcome market IDs to show | spike S4 output, human confirms which to feature in the demo                                                                                                |
| Testnet USDC for float                     | drip at app.hyperliquid-testnet.xyz/drip (see Stop 1)                                                                                                       |

**Tests (live HL testnet):**

- `hl.info.test.ts`: lists markets, returns a book with non-empty levels for each featured market.
- `hl.order.test.ts`: approve builder fee → place a marketable IOC order of minimum size → assert fill → assert fill record includes `builderFee > 0`.
- `hl.cancel.test.ts`: resting limit order far from mid → cancel → status `canceled`.

---

## Phase 5 — Core pipeline orchestration (Flow A end-to-end)

**Service:** `services/api` + `services/workers`

5.1 `POST /api/bets` → validate market, check Tempo limit via on-chain spend (Phase 2.4) → debit: Tempo stablecoin to treasury under the session key **and** confidential transfer user → escrow on Solana (Phase 3) → `open_position` → place HL order (Phase 4) → persist `Order`.
_Choose one source of truth for user funds:_ **Solana confidential balance is the bankroll**; the Tempo session spend is the _limit enforcement_ leg (a small per-bet "stake authorization" transfer to the treasury which is refunded/credited back on settlement). Document this clearly.
5.2 **Settlement worker:** on resolution → compute payout → `settle_position` → confidential transfer escrow → user → **Tempo payout with memo** (Flow A step 7).
5.3 Idempotency keys on every step; saga with compensations (refund on HL rejection).
5.4 WebSocket `/ws` streams order + settlement status to the client.

**Tests (live, all chains):** `e2e.flowA.test.ts` — create user → set $20 limit → fund confidential balance (devnet) → bet $2 on featured HL testnet market → assert HL fill, Solana position PDA, Tempo stake tx → trigger settlement path (resolve via real resolution or close the position and settle at mark if markets don't resolve during tests — **real close order, not a fake outcome**) → assert Tempo memo payout. Over-limit bet → 402/blocked with on-chain revert evidence.

---

## Phase 6 — Funding router (EVM testnets + Solana devnet + Tempo)

**Package:** `packages/evm-deposits`

6.1 Per-user deposit addresses: CREATE2 forwarder or HD-derived EOAs on Sepolia, Base Sepolia, Arb Sepolia. Accept testnet USDC (Circle testnet USDC addresses) and ETH.
6.2 Watcher: confirmations threshold per chain; on confirm, mint/transfer `tyrUSD` on devnet from treasury → user confidential `deposit` + `applyPendingBalance`.
6.3 Solana devnet direct deposit: user sends devnet USDC to deposit ATA (Phantom).
6.4 Tempo → Solana: user sends stablecoin with memo = userId-hash to tyr Tempo treasury → credit confidential balance.
6.5 Robinhood Chain testnet as funding source: same watcher pattern for test ETH/stablecoin.

🛑 **HUMAN STOP 6**

| Value                                                                                 | Where to get it                                                                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Testnet USDC contract addresses for Sepolia, Base Sepolia, Arb Sepolia, Solana devnet | developers.circle.com → USDC contract addresses (testnet)                                                   |
| Testnet USDC for the test user                                                        | faucet.circle.com                                                                                           |
| FX rule for ETH deposits (price source)                                               | human decides: Chainlink testnet ETH/USD feed address (docs.chain.link → data feeds → Sepolia) or USDC-only |

**Tests:** `deposit.<chain>.test.ts` for each source — send real testnet USDC from a test wallet → assert confidential balance increases (decrypt with owner key) and `Deposit.status = credited`.

---

## Phase 7 — Zcash: memo-as-order + FROST relayer (Flow B)

**Package:** `packages/zcash` + Rust sidecar `services/zcash-sidecar`

7.1 **Wallet sidecar (Rust):** `zcash_client_backend` + `zcash_client_sqlite` syncing from testnet lightwalletd; expose `GET /notes`, `POST /send`.
7.2 **Memo codec:** compact binary format (≤512 bytes): `v1 | marketId | side | size | returnUA | nonce | checksum`. TS + Rust implementations with shared test vectors.
7.3 **ZIP-321 request builder:** `zcash:<UA>?amount=..&memo=<base64url>`; QR rendered by frontend from API response.
7.4 **Scanner worker:** on new note → decode memo → create `ZcashOrder` → convert ZEC value to USD at a quoted rate → run the Flow A pipeline from 5.1 (debiting tyr's float).
7.5 **FROST 2-of-3:** ZF `frost-redpallas` trusted-dealer or DKG among 3 signer processes (3 separate containers with separate key shares) for the Orchard spend authorization of payouts. If the wallet stack cannot yet consume FROST signatures for Orchard spends, 🛑 stop and report — fallback requires human approval (e.g. FROST-signed authorization of a payout _instruction_ that a single hot wallet executes, disclosed as such).
7.6 **Payout:** shielded TAZ to `returnUA` with memo = receipt id.
7.7 **Viewing-key receipt:** export a payment disclosure / per-tx view for a single payout.

🛑 **HUMAN STOP 7**

| Value                                                          | Where to get it                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Testnet lightwalletd endpoint (confirm working)                | Stop 0                                                                      |
| ZEC/USD rate source for testnet conversion                     | human decides (e.g. fixed demo rate disclosed in UI, or a public price API) |
| FROST signer hosting (3 processes, same box OK for hackathon?) | human decision                                                              |

**Tests (live Zcash testnet):**

- `zcash.memo.test.ts` (TS + `cargo test`): codec round trip with shared vectors.
- `zcash.e2e.test.ts`: user wallet sends shielded TAZ with memo → scanner decodes within N blocks → HL testnet order placed → payout TAZ arrives at return UA (check with user wallet's sync).
- `frost.test.ts`: 2 of 3 signers produce a valid signature; 1 of 3 fails.

---

## Phase 8 — Agent API (Flow C)

8.1 API keys scoped to an `AgentSession`; agent authenticates with an ed25519/secp256k1 key registered by the owner.
8.2 Paid endpoints (`/api/agent/markets/:id/data`, `/api/agent/evidence/:id`) return **HTTP 402** with an MPP challenge; agent pays on Tempo Moderato within its session; server verifies payment on-chain before responding.
8.3 Agent bets go through the same pipeline with the agent's Tempo session as the cap.
8.4 Ship a minimal reference agent script (`examples/agent.ts`) that actually trades on testnet.

**Tests:** `agent.mpp.test.ts` — 402 → pay → 200; over-cap request → payment reverts → still 402. `agent.bet.test.ts` — reference agent places a real HL testnet order.

---

## Phase 9 — Robinhood Chain hedge (Flow D)

**Package:** `packages/robinhood`

9.1 **Geofence gate:** IP geolocation (MaxMind GeoLite2) + self-declared region at signup; hide hedge for US, CA, GB, CH, AE and sanctioned countries. Server-side enforcement on `/api/hedge`.
9.2 **Market → hedge mapping table:** HL macro/finance market ID → index-ETF Stock Token + direction (human-curated).
9.3 **Chainlink reader:** `latestRoundData()` via viem on the token's feed; stale-price check.
9.4 **Uniswap swap:** quote via the Uniswap Quoter / Universal Router deployed on Robinhood Chain testnet; execute from the tyr hot wallet on behalf of the user (custodial for hackathon; disclosed).
9.5 **Combined receipt:** bet payout + hedge P&L in one record, memo-tagged Tempo receipt.

🛑 **HUMAN STOP 9**

| Value                                                         | Where to get it                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Testnet Stock Token addresses (index ETF, e.g. S&P tracker)   | docs.robinhood.com/chain/building-with-stock-tokens → testnet token list |
| Chainlink feed addresses on Robinhood Chain testnet           | same docs page / docs.chain.link → Robinhood Chain                       |
| Uniswap Universal Router / Quoter / pool addresses on testnet | Uniswap docs deployments page, or Robinhood Chain docs                   |
| MaxMind license key                                           | maxmind.com (free GeoLite2 account)                                      |
| Market → Stock Token hedge mapping                            | human curates from Stop 4 market list                                    |

**Tests (live RH testnet):** `rh.chainlink.test.ts` (fresh price, 8 decimals), `rh.swap.test.ts` (real swap, balance delta matches quote within slippage), `rh.geofence.test.ts` (US IP → 403 from real GeoLite2 db).

---

## Phase 10 — Receipts & proofs

10.1 `Receipt` records for every payout with hash of canonical JSON; visibility private/public.
10.2 "Prove" exports: Tempo tx + memo; Solana auditor attestation (3.5); Zcash viewing-key disclosure (7.7).
10.3 Public verification page reads the chain directly to verify a receipt.

**Tests:** `receipts.test.ts` — generate receipt for a real settlement from Phase 5, verify against chain.

---

## Phase 11 — Backend API surface (freeze before frontend)

Publish an OpenAPI spec (`services/api/openapi.yaml`, generated from zod via `fastify-type-provider-zod`) and a typed client (`packages/api-client`, generated with `openapi-typescript`).

| Method  | Path                                             | Purpose                                     |
| ------- | ------------------------------------------------ | ------------------------------------------- |
| POST    | `/api/auth/passkey/register/options` · `/verify` | WebAuthn registration                       |
| POST    | `/api/auth/passkey/login/options` · `/verify`    | WebAuthn login → session cookie             |
| POST    | `/api/tempo/sponsor`                             | co-sign sponsored tx                        |
| GET/PUT | `/api/limits`                                    | read/set loss limit                         |
| GET     | `/api/balance`                                   | decrypted confidential balance (owner only) |
| GET     | `/api/deposits/addresses`                        | per-chain deposit addresses                 |
| GET     | `/api/deposits`                                  | deposit history                             |
| GET     | `/api/markets` · `/api/markets/:id`              | HL outcome markets + book                   |
| POST    | `/api/bets`                                      | place bet                                   |
| GET     | `/api/bets` · `/api/bets/:id`                    | bet status                                  |
| POST    | `/api/zcash/request`                             | ZIP-321 URI for a bet                       |
| GET     | `/api/hedge/:marketId/quote` · POST `/api/hedge` | hedge (geofenced)                           |
| GET     | `/api/receipts` · `/api/receipts/:id/proof`      | receipts                                    |
| POST    | `/api/agent/sessions`                            | create capped agent session                 |
| *       | `/api/agent/*`                                   | MPP-paid agent endpoints                    |
| GET     | `/api/admin/revenue`                             | builder fee earned                          |
| WS      | `/ws`                                            | live order/settlement/deposit events        |

**Tests:** `api.contract.test.ts` — every route against the running server, schema validated; full e2e re-run of Flows A–D through HTTP only.

✅ **Backend done gate:** all phase suites green on live testnets in one CI run; `docs/evidence.md` updated.

---

## Phase 12 — Frontend (Next.js + TypeScript)

**App:** `apps/web` — Next.js App Router, TypeScript strict, Tailwind + shadcn/ui, TanStack Query, generated `api-client`, `@simplewebauthn/browser`, Phantom via wallet-standard (Solana devnet), viem for Tempo signing where the passkey signs.

Screens (mobile-first):

1. `/` landing + "Continue with fingerprint".
2. `/onboarding/limit` — set daily/weekly loss limit.
3. `/fund` — chain picker, deposit addresses + QR, live deposit status (WS).
4. `/markets` & `/markets/[id]` — book, odds, one-tap bet, optional hedge card (only if API says eligible).
5. `/zcash` — ZIP-321 QR for a bet, "waiting for shielded payment" status.
6. `/portfolio` — hidden-balance view (decrypt on demand), open bets, settlements.
7. `/receipts/[id]` — prove/keep-private toggle, verification links to explorers.
8. `/agents` — create capped session, show API key, live spend vs cap.
9. Persistent **"What's private here"** panel (honesty requirement from idea §6).

Rules: no chain RPC calls from the browser except passkey/Phantom signing; all data via the API; every explorer link points to the testnet explorer.

**Tests:** Playwright e2e against the real backend on testnets, using Chromium's virtual WebAuthn authenticator (CDP `WebAuthn.addVirtualAuthenticator`) — sign up → set limit → fund (devnet) → bet → see settlement. Run before every demo recording.

🛑 **HUMAN STOP 12** — brand assets/logo, domain DNS for `tyr.bet` (registrar the human uses), hosting choice (Vercel for web, Railway for API/workers/Postgres/Redis), and production `WEBAUTHN_RP_ID=tyr.bet`.

---

## Phase 13 — Demo & submission (Oct 11–12)

- Freeze scope Oct 11. Re-run full e2e suite; fill `docs/evidence.md` with fresh tx hashes per chain.
- Record 90-second demo per idea.md script, stating clearly: **all testnet**, which hops are tyr-operated relayers, and what is/isn't private.
- README: architecture, how to run, every testnet contract/program address, tracks claimed and the exact feature for each.
- Open-source the funding router + Zcash relayer (Public Goods).

🛑 **HUMAN STOP 13** — Colosseum registration for every team member, submission form track selection (re-check multi-track), demo video upload.

---

## Appendix A — Master list of human-supplied values

| #   | Value                                                    | Phase | Source                                                  |
| --- | -------------------------------------------------------- | ----- | ------------------------------------------------------- |
| 1   | All testnet RPC URLs + chain IDs                         | 0     | Chain docs / Alchemy / Helius                           |
| 2   | Funded treasury/hot wallets on each testnet              | 1     | Faucets listed in Stop 1                                |
| 3   | Hyperliquid testnet USDC + agent wallet approval         | 1, 4  | app.hyperliquid-testnet.xyz                             |
| 4   | Tempo testnet stablecoin + keychain addresses            | 2     | tempo.xyz/developers                                    |
| 5   | WebAuthn RP ID / domain                                  | 2, 12 | Human                                                   |
| 6   | Devnet CT feature confirmation, program authority        | 3     | Spike S1 / human                                        |
| 7   | Builder address + fee rate + featured markets            | 4     | HL docs + human                                         |
| 8   | Testnet USDC addresses                                   | 6     | developers.circle.com                                   |
| 9   | ZEC/USD and ETH/USD rate sources                         | 6, 7  | Human                                                   |
| 10  | FROST hosting / fallback approval                        | 7     | Human                                                   |
| 11  | Stock Token, Chainlink feed, Uniswap addresses (testnet) | 9     | docs.robinhood.com/chain, docs.chain.link, Uniswap docs |
| 12  | MaxMind key                                              | 9     | maxmind.com                                             |
| 13  | Hosting, DNS, branding                                   | 12    | Human                                                   |
| 14  | Colosseum registration + submission                      | 13    | colosseum.com/worldsfair                                |

## Appendix B — Decisions requiring human sign-off (not just values)

- Any fallback in §0.2 (devnet CT disabled, no HIP-4 on testnet).
- Custodial key model for confidential accounts (server-derived vs passkey PRF).
- FROST fallback if Orchard FROST spending isn't usable.
- Cutting a chain if its role can't be demoed clearly (idea §6 scope risk).

## Appendix C — Day plan

| Date      | Work                                                                        |
| --------- | --------------------------------------------------------------------------- |
| Oct 4     | Phase 0, Stops 0–1, spikes S1–S5 start                                      |
| Oct 5–6   | Finish spikes; Phase 2 (Tempo), Phase 3 (Solana)                            |
| Oct 7     | Phase 4 (HL), Phase 5 (Flow A e2e green)                                    |
| Oct 8     | Phase 6 (funding), Phase 7 (Zcash)                                          |
| Oct 9     | Phase 7 finish, Phase 8 (agent), Phase 9 (hedge), Phase 10, Phase 11 freeze |
| Oct 10–11 | Phase 12 frontend + Playwright; scope freeze Oct 11                         |
| Oct 12    | Phase 13 demo + submission                                                  |
