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

| Date       | Decision                                                                                                                                                                                                                                                                                      | Approved by                                   | Reason                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | **Zcash runs on LOCAL REGTEST** (infra/zcash-regtest: zebrad 6.3.0 + zainod 0.10.1, the pair zingolib CI pins), not public testnet. Funds are self-mined; coinbase → tyr transparent addr → shielded via zingo `quickshield`. Same protocol/wallet code as testnet; txs not publicly visible. | Human (project owner): "do all stuff locally" | No reachable TAZ faucet; owner cannot use Discord. Switch back by pointing at testnet.zec.rocks:443 once TAZ exists. |

## Zcash regtest wallets (seeds in .env only)

| Wallet | Unified address (regtest)                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tyr    | `uregtest126e6ddp8prwkskuaeumsv5zfkqjez7gawtuxlk0h98akq7txzswrlzhjq8csf0h3fwqhfqdz0tczslvjwdz8d54wn2kdmy03rsf24sah` (t-addr miner `tmFEiV49cx5aZE7yi4viW4d5nBRVja9CmE6`) |
| user   | `uregtest1lsg9ypg8r478vmv226f7je53c6de7w9lq5d974t0jcnu7nhjlk27h63egwvycjafrt75cneg8q3af0ck5t6rtc55p0nrrz436vexnc5u`                                                      |

zingo-cli is built from zingolib with `--no-default-features --features nakednet-test-mode` (no Nym mixnet; required to reach a local server).
