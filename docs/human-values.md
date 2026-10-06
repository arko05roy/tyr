# Human-supplied values

Public parts only. Private keys live in `.env` / secrets manager, never here.

| #   | Value                                      | Phase | Value (public)                                                                                                                             | Source                                                                           | Date       |
| --- | ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------- |
| 1   | `TEMPO_RPC_URL` / `TEMPO_CHAIN_ID`         | 0     | `https://rpc.moderato.tempo.xyz` / `42431`                                                                                                 | docs.tempo.xyz/quickstart/connection-details; eth_chainId verified               | 2026-10-05 |
| 1   | `ROBINHOOD_RPC_URL` / `ROBINHOOD_CHAIN_ID` | 0     | `https://rpc.testnet.chain.robinhood.com` / `46630`                                                                                        | docs.robinhood.com/chain/connecting (public, rate-limited); eth_chainId verified | 2026-10-05 |
| 1   | `ZCASH_LIGHTWALLETD_URL`                   | 0     | `testnet.zec.rocks:443`                                                                                                                    | zechub.wiki lightwallet nodes; GetLightdInfo chainName=test verified             | 2026-10-05 |
| 1   | `SOLANA_RPC_URL`                           | 0     | `https://api.devnet.solana.com`                                                                                                            | public devnet (PRD default)                                                      | 2026-10-05 |
| 1   | `HL_API_URL`                               | 0     | `https://api.hyperliquid-testnet.xyz`                                                                                                      | HL docs                                                                          | 2026-10-05 |
| 2   | Solana treasury (devnet)                   | 1     | `BTNRR8rwc3njqJZiVbApsbbEodyWYcgu9HmFcGSRWb5N`                                                                                             | generated (solana-keygen), 5 SOL from spike payer                                | 2026-10-05 |
| 2   | Tempo sponsor                              | 1     | `0xfc4e905a3331dB5B24d7c2DF5663A87b73D5707D`                                                                                               | generated (viem); funded via `tempo_fundAddress`                                 | 2026-10-05 |
| 3   | HL master / agent / builder                | 1,4   | `0x6d152af5439F54e2a013ccD69272810e0BCcfA76` / `0xc221DE048a36007a9cb6519E0Bdc0eED18afe745` / `0x8F7eC599D1FCb6fAD46630a52cf3f8FAd1216f03` | generated (viem); awaiting testnet USDC                                          | 2026-10-05 |
| 2   | Robinhood hot wallet                       | 1     | `0xeB6d102bFe46fd4934Db133C03020CC95a7F166A`                                                                                               | generated (viem); awaiting faucet                                                | 2026-10-05 |

## Decisions (Appendix B sign-offs)

| Date       | Decision                                                                                                                                                                                                                                                         | Approved by           | Reason                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | Hyperliquid order **execution is simulated** (paper fills against the real live HL testnet L2 book; results flagged `simulated: true`, no tx/oid fabricated). Market data (outcomeMeta, books, mids) stays live testnet. Builder-fee proof deferred.             | Human (project owner) | HL testnet USDC requires an address with HL mainnet state (drip + Circle CCTP both enforce it); owner has none. Swap to real execution once a funded testnet account exists. |
| 2026-10-05 | Robinhood hedge **swap is simulated**. Real: RH testnet chain, official faucet Stock Tokens (TSLA/AMD/AMZN/NFLX/PLTR), hot-wallet balances. Price = Hyperliquid testnet `xyz` dex mid (not Chainlink). Quote = mid × (1 − 30bp fee − 20bp slippage); no tx sent. | Human (project owner) | No official Chainlink feed or Uniswap pool/quoter found on RH testnet (Uniswap docs list mainnet only; testnet has UniversalRouter + Permit2 only).                          |

## Robinhood Chain testnet Stock Tokens (official faucet)

| Symbol | Address                                      |
| ------ | -------------------------------------------- |
| TSLA   | `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` |
| AMD    | `0x71178BAc73cBeb415514eB542a8995b82669778d` |
| AMZN   | `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02` |
| NFLX   | `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93` |
| PLTR   | `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0` |

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                            | Approved by                                   | Reason                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | **Zcash runs on LOCAL REGTEST** (infra/zcash-regtest: zebrad 6.3.0 + zainod 0.10.1, the pair zingolib CI pins), not public testnet. Funds are self-mined; coinbase → tyr transparent addr → shielded via zingo `quickshield`. Same protocol/wallet code as testnet; txs not publicly visible.                                                                       | Human (project owner): "do all stuff locally" | No reachable TAZ faucet; owner cannot use Discord. Switch back by pointing at testnet.zec.rocks:443 once TAZ exists. |
| 2026-10-06 | **FROST spend fallback in effect** — zingolib has no PCZT / external spend-auth signing path, so FROST 2-of-3 (RedPallas, 3 containers) signs a canonical payout _instruction_ (`receipt_id, to, zat, memo`); the sidecar's hot wallet spends only with a valid group signature. Signers enforce an amount cap, UA-only recipients, and never sign a receipt twice. | Human (project owner), Stop 7                 | Native Orchard/Ironwood FROST spending is not consumable by the wallet stack. Disclosed in README/demo.              |
| 2026-10-06 | **Viewing-key receipt (7.7) = OVK view + FROST**, not ZIP-311 — tyr's wallet decrypts its own outgoing output for one payout txid and the FROST signature over the instruction is re-verified; `matches` only if they agree.                                                                                                                                        | Builder (within Stop 7 fallback)              | zingolib has no payment-disclosure support.                                                                          |

## Zcash regtest wallets (seeds in .env only)

| Wallet | Unified address (regtest)                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tyr    | `uregtest126e6ddp8prwkskuaeumsv5zfkqjez7gawtuxlk0h98akq7txzswrlzhjq8csf0h3fwqhfqdz0tczslvjwdz8d54wn2kdmy03rsf24sah` (t-addr miner `tmFEiV49cx5aZE7yi4viW4d5nBRVja9CmE6`) |
| user   | `uregtest1lsg9ypg8r478vmv226f7je53c6de7w9lq5d974t0jcnu7nhjlk27h63egwvycjafrt75cneg8q3af0ck5t6rtc55p0nrrz436vexnc5u`                                                      |

zingo-cli is built from zingolib with `--no-default-features --features nakednet-test-mode` (no Nym mixnet; required to reach a local server).

## HUMAN STOP 2 values (defaults accepted by owner 2026-10-05)

| Value                   | Setting                                                            | Source                                                                 |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Stablecoin              | AlphaUSD `0x20c0000000000000000000000000000000000001` (6 dp)       | Moderato faucet token (tempo.xyz/docs/quickstart/faucet)               |
| Access-key / keychain   | via `viem/tempo` `Actions.accessKey` (account keychain precompile) | viem 2.57.3                                                            |
| WebAuthn RP ID / origin | `localhost` / `http://localhost:3000`                              | owner default for dev; `tyr.bet` at Phase 12                           |
| MPP over HTTP 402       | `mppx` 0.13.1 tempo `charge` (pull mode, tyr fee-payer), AlphaUSD  | mpp.dev / npm `mppx` (Phase 8, no new secret: HMAC of TYR_SECRETS_KEY) |

## HUMAN STOP 3 values (owner answers 2026-10-05)

| Value                            | Setting                                                                                                    | Source                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| ZK ElGamal program on devnet     | active                                                                                                     | Spike S1 (live CT round trip)                    |
| Program deploy/upgrade authority | `9UjbEGTR4UCL5vHHDx6gH7m9cYwZtpoUYhdCBd2NyL2R` (`keys/solana-deployer.json`, also Config admin)            | generated (solana-keygen), 4.5 SOL from s1-payer |
| `tyr_settlement` program id      | `9MsrEuoEHPJVvfYkWaCuZyzryDvr67XGXeQtk4FXFpxr` (`keys/tyr_settlement-program.json`)                        | generated                                        |
| Auditor key                      | **enabled** — ElGamal pubkey `2fZqrbpgdAhygZ13eVujnME4h1C4YijApWZQwpFoCWbs` (from `SOLANA_AUDITOR_SEED`)   | owner decision                                   |
| tyrUSD mint                      | `D4Gtpr8Xjnq5AZ5NU8JT32Wwn8BUMz52ZAbjneDqHm5S` (6 dp, CT auto-approve, authority = treasury)               | `scripts/solana-setup.ts`                        |
| Relayer                          | treasury `BTNRR8rwc3njqJZiVbApsbbEodyWYcgu9HmFcGSRWb5N`                                                    | default                                          |
| tyr escrow CT account            | owner `6pw4KRHDHgXZthjrCEu3XNPMizwWzKsDGcKxvWsYyzC3`, token `AyKQfJJjH86XBzAxaYaMMTyzGw1A7idfyhTZqJZYLNZo` | derived from `TYR_SECRETS_KEY`                   |

| Date       | Decision                                                                                                                                                                                                                                                                           | Approved by           | Reason                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | **Server-derived custody** for confidential accounts: one random 32-byte secret per user, sealed with `TYR_SECRETS_KEY`; Solana owner key + ElGamal/AE keys derived from it; proofs generated in Node (`@solana/zk-sdk` WASM). Custodial — must be disclosed in the privacy panel. | Human (project owner) | PRD default; passkey-PRF/browser proving is a stretch goal.                                                               |
| 2026-10-05 | **Auditor enabled** on tyrUSD: tyr's compliance key can decrypt transfer amounts (not available balances). Disclose in the privacy panel.                                                                                                                                          | Human (project owner) | Powers 3.5 attestation + Phase 10 "prove a payout".                                                                       |
| 2026-10-05 | Position `size_commitment`/`payout_commitment` are salted SHA-256 commitments (`sha256("tyr/amount/v1"‖u64le‖salt32)`), not Pedersen.                                                                                                                                              | Builder (deviation)   | zk-sdk JS cannot serialize a Pedersen opening, so it could not be stored for later proofs. Hiding + binding is preserved. |

## HUMAN STOP 4 values (owner answers 2026-10-05)

| Value                 | Setting                                                                                                                       | Source         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `TYR_BUILDER_ADDRESS` | `0x6d152af5439F54e2a013ccD69272810e0BCcfA76` (= HL master). Holds 0 testnet USDC, so builder-fee approval is not yet possible | owner decision |
| Builder fee `f`       | `10` tenths-of-bp (1 bp)                                                                                                      | owner decision |
| Featured markets      | automatic: every outcome with a future deadline (`time`/`resolutionDeadline`) and a two-sided YES book, recomputed per call   | owner decision |
| Testnet USDC (float)  | still none: `HL_EXECUTION=paper`; flip to `live` once funded (code path exists in `LiveExecutor`)                             | Stop 1 blocker |

| Date       | Decision                                                                                                                                                                                                                   | Approved by           | Reason                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| 2026-10-05 | **Pooled float + internal ledger** (PRD 4.3): one HL account trades for all users; per-user exposure = `Order` rows. Paper resting orders exist only in tyr's ledger.                                                      | Human (project owner) | Sub-account creation needs a funded master; execution is simulated anyway.             |
| 2026-10-05 | Resolution detection: HL has no "resolved" flag — an outcome is **resolved** when it disappears from `outcomeMeta` (winner from the last pinned mid ≥ 0.99 / ≤ 0.01), **expired** when past its deadline but still listed. | Builder (deviation)   | Expired outcomes stay listed until the deployer calls `settleOutcome` (observed live). |

## HUMAN STOP 6 values (owner answers 2026-10-06)

| Value                         | Setting                                                                                                                                                                                                 | Source                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| USDC — Sepolia                | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`                                                                                                                                                            | developers.circle.com (owner-verified); on-chain: `USDC`, 6 dec        |
| USDC — Base Sepolia           | `0x036CbD53842c5426634e7929541eC2318f3dCF7e`                                                                                                                                                            | developers.circle.com (owner-verified); on-chain: `USDC`, 6 dec        |
| USDC — Arb Sepolia            | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`                                                                                                                                                            | developers.circle.com (owner-verified); on-chain: `USD Coin`, 6 dec    |
| USDC — Solana devnet          | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (classic SPL Token)                                                                                                                                      | developers.circle.com (owner-verified); on-chain: Tokenkeg mint, 6 dec |
| ETH FX rule                   | Chainlink ETH/USD on Sepolia `0x694AA1769357215DE4FAC081bf1f309aDC325306` for ETH on every EVM source; price older than 3h → deposit not priced                                                         | owner decision; docs.chain.link (on-chain: `ETH / USD`, 8 dec)         |
| Deposit addresses             | HD-derived EOAs from `EVM_DEPOSIT_MNEMONIC` (`m/44'/60'/0'/0/i`, one index per user, same address on all EVM testnets). No sweep — funds stay at the tyr-custodied address                              | owner decision                                                         |
| Sepolia / Base / Arb RPCs     | `https://ethereum-sepolia-rpc.publicnode.com` / `https://sepolia.base.org` / `https://sepolia-rollup.arbitrum.io/rpc` (public, rate-limited; swap for Alchemy any time); chain IDs checked by the guard | builder default (official/public endpoints)                            |
| Robinhood Chain deposits      | test ETH only (no Circle USDC on RH testnet), priced by the Sepolia feed                                                                                                                                | follows from FX rule                                                   |
| EVM test sender (test "user") | `0xf5884c4cfb8a3Bf0913A724C39a5325cf27825c0` — needs Circle USDC + gas ETH on Sepolia, Base Sepolia, Arb Sepolia (RH ETH seeded from the hot wallet)                                                    | generated (viem)                                                       |
| Solana test sender            | `GY8ew95nFf8zfXJtKtNUWs9ZhCpiHfDcsYoF6x7bjDSv` — needs Circle devnet USDC (0.2 SOL seeded from treasury)                                                                                                | generated (`solana-keygen`)                                            |

| Date       | Decision                                                                                                                                                                                                                                               | Approved by                      | Reason                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------- |
| 2026-10-06 | ETH deposits are **claimed by tx hash** (`POST /api/deposits/claim`) and verified on-chain (success receipt, `to` = user's deposit EOA, N confirmations). USDC is auto-detected from `Transfer` logs by the watcher (claim also works as a fast path). | Builder (within Stop 6 decision) | Native ETH emits no log; full-block scans of Arb/Base Sepolia are too heavy for public RPCs. |
| 2026-10-06 | **EVM USDC live tests waived**: the EVM test sender is not funded. Sepolia / Base Sepolia / Arb Sepolia USDC watcher code ships, but its live tests are opt-in (`RUN_EVM_USDC_TESTS=1`). EVM deposit path proven live via Robinhood ETH claim.         | Human (project owner)            | Owner: "the first one is not needed"                                                         |

## HUMAN STOP 7 values (owner answers 2026-10-06)

| Value                | Setting                                                                                                                                                                      | Source                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| lightwalletd         | local regtest zainod `http://127.0.0.1:9067` (testnet `testnet.zec.rocks:443` once TAZ exists)                                                                               | Stop 0 + 2026-10-05 decision |
| ZEC/USD rate source  | public price API (CoinGecko simple price, read-only); rate used is persisted on each `ZcashOrder`                                                                            | owner decision               |
| FROST signer hosting | 3 separate containers on the same box, one key share each                                                                                                                    | owner decision               |
| FROST spend fallback | **approved**: if Orchard/Ironwood spends can't consume FROST sigs, 2-of-3 FROST signs the payout instruction; hot wallet executes only valid-signed instructions (disclosed) | owner decision               |

## HUMAN STOP 9 values (owner answers 2026-10-06)

| Value                         | Answer                                                                                                                                       | Source                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Geofence input                | **Self-declared region only** (`PUT /api/auth/region`, ISO alpha-2). No IP geolocation / MaxMind key. Undeclared region → hedge not offered. | Owner                              |
| Blocked regions               | PRD default list: US, CA, GB, CH, AE (no extra sanctions list)                                                                               | Owner ("1")                        |
| Market → hedge mapping        | Rule-based over HL outcome templates (table below), proposed by builder, **pending owner approval**                                          | Owner: "auto-propose, you approve" |
| Stock Tokens                  | Official faucet tokens (section above); no index ETF exists on RH testnet                                                                    | Stop 1 / S5                        |
| Chainlink / Uniswap addresses | None exist on RH testnet — covered by the 2026-10-05 simulated-swap decision                                                                 | S5                                 |

Hedge mapping rules (`packages/robinhood/src/mapping.ts`). A hedge pays when the bet loses; NO bets take the opposite trade.

| HL market                                        | Stock                  | Trade offsetting a YES bet |
| ------------------------------------------------ | ---------------------- | -------------------------- |
| `binaryPrice*` on US500 / S&P index              | AMZN (large-cap proxy) | sell                       |
| `binaryPrice*` on `xyz:TSLA/AMD/AMZN/NFLX/PLTR`  | same stock             | sell                       |
| Fed hike (`policyRateIncrease`, increase bucket) | AMZN                   | buy                        |
| Fed cut (`policyRateDecrease`, decrease bucket)  | AMZN                   | sell                       |
| CPI "Above x%"                                   | AMZN                   | buy                        |
| CPI "Below x%"                                   | AMZN                   | sell                       |
| US government stake in Nvidia                    | AMD                    | sell                       |
| anything else (sports, crypto, …)                | — no hedge             |                            |

| Date       | Decision                                                                                                                                                                                                                                            | Approved by                               | Reason                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 2026-10-06 | **Geofence = self-declared region, no IP lookup** (PRD 9.1 called for MaxMind GeoLite2). Enforced server-side on every `/api/hedge` route. `rh.geofence` is covered by the Flow D e2e via HTTP instead of a GeoLite2 IP test.                       | Human (project owner), Stop 9             | Owner choice.                                                                                           |
| 2026-10-06 | **Hedge price = HL testnet `xyz` `oraclePx`** (not the book mid named in the 2026-10-05 decision): xyz books are one-sided on testnet. HL exposes no oracle timestamp, so the stale check rejects a missing price or one diverging > 25% from mark. | Builder (within the 2026-10-05 deviation) | No two-sided book; oracle is the closest analog to a Chainlink answer.                                  |
| 2026-10-06 | **Combined receipt anchor = zero-value Tempo `transferWithMemo`** to the user, memo = keccak256("receipt:<id>"). Hedge cash moves on the Solana CT bankroll (debit on open, credit on close), not on Tempo.                                         | Builder                                   | Keeps one source of truth for funds (PRD 5.1) while still giving a memo-tagged Tempo receipt (PRD 9.5). |
