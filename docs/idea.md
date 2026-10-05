# idea.md — Private Any-Chain Prediction Terminal

> Working title: **Veil** (placeholder, rename freely).
> Purpose of this file: the single source of truth for the idea. Derive the technical PRD, architecture and task breakdown from it.
> Written: 2026-10-04. Updated: Robinhood Chain track added; multi-track entry confirmed by the builder (not stated in the public rules). Event: Crypto World's Fair Hackathon (Colosseum). **Submission deadline: Oct 12, 2026, 11:59pm PT** (06:59 UTC Oct 13).

Legend: **[Verified]** = read from a source this session. **[Unverified]** = plausible but must be checked before building on it.

---

## 1. The idea in simple terms

Prediction markets let people bet YES/NO on real-world events ("Will X happen by Friday?"). They are the hottest category in crypto right now, but today they are:

- **Public.** Anyone can see your balance, your bets, and your wallet history.
- **Annoying to use.** You need a wallet, the right chain, gas tokens, and a seed phrase.
- **Fragmented.** Liquidity is spread over many venues.

**Veil is a prediction-market app where you:**

1. **Sign up with a fingerprint** (no seed phrase, no gas).
2. **Fund it privately**, either from any chain or by sending shielded Zcash with a message that *is* the bet.
3. **Keep your bankroll hidden** in an encrypted balance on Solana.
4. **Trade on the deepest venue** (Hyperliquid's outcome markets) while the app earns a routing fee. For macro/finance events, **hedge in one tap** with an index-ETF Stock Token on Robinhood Chain (eligible regions only).
5. **Set a hard loss limit** that nothing, including an AI agent, can exceed.
6. **Get paid** into a simple stablecoin account, with receipts you can prove or keep private.

One-line pitch: *"Bet on anything, from any chain, with a hidden bankroll and a loss limit you can't break."*

### Why each chain is here (each does a job only it can do)

| Chain | Job in the product | One-line reason |
|---|---|---|
| **Tempo** | Home account: passkey login, gasless, spend limits, receipts, payouts, agent API | It has native passkeys, sponsored fees, batching, spend-limited payment sessions, and memos |
| **Zcash** | Private entry: a shielded payment with an encrypted memo *is* the order | Only Zcash has shielded transfers with a built-in encrypted message field |
| **Solana** | Confidential custody and settlement | Confidential Balances hides balances and amounts natively, and Solana's own stage is pushing prediction markets and agents |
| **Hyperliquid** | Where bets execute; builder-code fee is the business model | New native outcome markets (HIP-4) sharing one deep order book |
| **Robinhood Chain** | "Bet and hedge": hedge a macro/finance outcome bet with an index-ETF Stock Token; also a funding source | Open 24/7 tokenized-stock trading, with an official Chainlink price feed per token, on an Arbitrum-stack chain |
| **Base / Arbitrum / Ethereum L1** | Deposit sources (thin integration) | Users already hold funds there |

---

## 2. Why this idea (decision record)

- **Not payments/treasury.** The builder shipped a payments/treasury product last cohort and won nothing. Payments are also the most crowded Colosseum winner category: 22 of 180 recorded winners (12%) [Verified, Copilot corpus].
- **Prediction markets keep winning.** Prediction markets + sports betting = 18 of 180 recorded winners; prediction markets alone were 7 of the 61 winners in the two latest events (Cypherpunk, Frontier). Solana-only corpus; categories are auto-classified [Verified, Colosseum Copilot].
- **Solana is publicly pushing the same themes.** Breakpoint 2026 (Nov 15–17, London) Day 2 headlines AI agents and prediction markets [Verified].
- **Winners tend to be tangible and polished.** Cypherpunk's Grand Champion was a physical hardware wallet [Verified].
- **Coverage across prize tracks is intentional** ("trackmaxxing"): see section 7.

---

## 3. User flow

### Persona
A retail bettor who wants privacy and zero crypto friction, plus a secondary persona: **an AI agent** that trades on its owner's behalf under a spending cap.

### Flow A — Standard onboarding (any chain)

1. **Sign up.** User taps "Continue with fingerprint/Face ID". A Tempo passkey account is created. No seed phrase. Fees are sponsored by the app. *(Tempo)*
2. **Set a loss limit.** User picks a daily/weekly ceiling (e.g. $50/day). This opens a spend-limited session. *(Tempo MPP session)*
3. **Fund.** User deposits from Base, Arbitrum, Ethereum, Solana, etc. The app routes the deposit into the user's confidential balance. *(cross-chain route → Solana)*
4. **Browse markets.** Markets are the Hyperliquid outcome markets, shown in a clean, mobile-first UI.
5. **Place a bet.** One tap. Behind the scenes: the order is routed to Hyperliquid through the app's builder code; the fee accrues to the app. *(Hyperliquid)*
6. **Hidden bankroll.** The user's balance and transfer amounts are encrypted on Solana; the explorer shows only that an account exists. *(Solana Confidential Balances)*
7. **Settle and get paid.** When the market resolves, winnings arrive in the user's Tempo account in a stablecoin, with a memo-tagged receipt. *(Tempo TIP-20 memo)*
8. **Prove or hide.** User can export a receipt/proof of a payout (e.g. for taxes) or keep it private. *(Zcash viewing key for the Zcash path; Solana auditor-key option for the Solana path)*

### Flow B — Zcash "the payment is the order"

1. User scans a **payment-request QR** and sends **shielded ZEC** to the app's address. *(Zcash unified address, ZIP-321)*
2. The **encrypted memo** inside that payment holds the order: market, side, size, and a shielded return address. Nothing about the bet is visible on-chain. *(Zcash 512-byte memo)*
3. A **threshold relayer** (no single operator holds the money) decrypts the memo with the viewing key and executes the bet through the normal pipeline (Flow A, steps 5–7). *(FROST threshold group — see risks)*
4. Winnings are paid back as **shielded ZEC** to the return address in the memo.
5. User can hand over a **viewing key / receipt** to prove a specific payout without exposing their whole history.

### Flow C — AI agent under a cap

1. The owner funds an agent and opens a **spend-limited session**. *(Tempo MPP)*
2. The agent trades via the app's API and pays per call for market data and resolution evidence. *(Tempo MPP)*
3. The agent physically cannot spend beyond the limit; the owner sees receipts. *(Tempo)*

### Flow D — Bet and hedge (Robinhood Chain)

Only shown to users in eligible regions (see section 6). Demo runs on the Robinhood Chain **testnet** with simulated Stock Tokens.

1. User opens a **macro/finance market** on Hyperliquid (e.g. a Fed rate decision). *(Hyperliquid)*
2. The app offers a **hedge**: a position in a matching index-ETF Stock Token (e.g. S&P-tracking). *(Robinhood Chain Stock Tokens)*
3. User taps once; the app places the outcome bet and swaps into the Stock Token through an open venue such as Uniswap. *(Robinhood Chain DEX)*
4. The hedge's price is displayed from the token's **Chainlink price feed**. *(Chainlink on Robinhood Chain)*
5. When the market resolves, the payout and hedge P&L are shown together in one receipt. *(Tempo memo receipt)*

Note: **no equity or earnings outcome markets were found on Hyperliquid**, so the hedge is for macro/finance events, not stock-specific bets.

### Demo script (target: 90 seconds)

1. Fingerprint sign-up → account exists, zero gas. *(Tempo)*
2. Set a $20/day limit.
3. Scan a QR, send shielded ZEC with a memo; nothing about the bet is visible on-chain. *(Zcash)*
4. Show the Solana explorer: the bankroll account exists, the amount is encrypted. *(Solana)*
5. Show the bet live on Hyperliquid and the builder-code fee line. *(Hyperliquid)*
6. Resolve a market; payout arrives with a memo receipt. *(Tempo)*
7. Try to bet over the limit → blocked. *(Tempo)*
8. (Optional, testnet) On a Fed-decision market, tap "hedge" and show the Stock Token position and Chainlink price. *(Robinhood Chain)*

**Be explicit in the demo about what is and isn't private** (see limits below).

---

## 4. Tech involved (no code; docs and what each piece is used for)

### 4.1 Tempo — home account, limits, receipts, payouts, agent API
- **Docs:** https://tempo.xyz/developers (the old docs.tempo.xyz redirects here) [Verified]
- **MPP announcement/overview:** https://agents.tempo.xyz/blog/mainnet [Verified]
- **Mainnet launch coverage:** https://www.alchemy.com/blog/tempo-mainnet-alchemy [Verified]
- **Primitives to use** [Verified on the developers page]:
  - *Tempo Transactions*: passkey (WebAuthn) signing, fee sponsorship, batching, parallelizable nonces, expiring nonces.
  - *TIP-20* stablecoins: 32-byte transfer memos (reconciliation), permit (gasless approvals), TIP-403 policy registry (allow/block lists).
  - *Payment lanes* and *any-stablecoin fees* (fee AMM), plus the *enshrined stablecoin DEX*.
  - *Machine Payments Protocol (MPP)*: sessions ("authorize once, then pay within defined limits"), spend limits, per-request payment via HTTP 402. Co-authored by Stripe and Tempo [Verified].
  - *Tempo Zones* ("private chain operations anchored to Tempo") are listed on the page; **availability is unknown** — treat as a stretch.
- **Networks:** Testnet "Moderato" with a free faucet; mainnet live with pathUSD [Verified on the page].

### 4.2 Zcash — shielded entry, memo-as-order, selective disclosure
- **Library/overview:** https://zechub.wiki/glossary-and-faqs/zcash-library [Verified via search; page not fetched]
- **Shielded/ecosystem news (FROST multisig, Tachyon, Z3 progress):** https://zechub.substack.com/p/zcash-shielded-news-vol60 [Verified via search]
- **Cross-chain routes (NEAR Intents via SwapKit):** https://swapkit.dev/blog/swapkit-zcash-integration/ — routes to SOL/ETH/Arbitrum/Base currently support **transparent** Zcash addresses; shielded is "under evaluation"; page is undated, so re-check [Verified via search]
- **Primitives to use:** unified addresses, Orchard shielded pool, 512-byte encrypted memos, ZIP-321 payment-request URIs/QR, incoming viewing keys, FROST threshold signing [memos, UAs, ZIP-321 verified via search; FROST via zKool news].
- **Specs to read (not fetched yet):** ZIP-321 https://zips.z.cash/zip-0321 [Unverified link]; Zcash Foundation FROST docs https://frost.zfnd.org [Unverified link].

### 4.3 Solana — confidential custody and settlement
- **Privacy primitives overview:** https://solana.com/docs/finance/privacy [Verified]
  - *Confidential Balances* (Token-2022 extension): hides balances and transfer amounts; accounts, mint, owners, and participation stay visible; optional ElGamal auditor key can decrypt transfer amounts (not balances); uses the ZK ElGamal Proof Program. Documented as production.
  - *Solana Privacy Rings* (Helius): beta; stretch only.
  - *Private Channels*: institution-operated; likely out of scope.
- **Confidential Transfers back on mainnet (June 17, 2026) after a year-long security pause:** https://solanacompass.com/news/confidential-transfers-return-to-solana-mainnet-after-year-long-security-pause [Verified]
- **Roadmap context (Alpenglow, Firedancer):** https://www.blockdaemon.com/blog/solana-in-2026-technical-roadmap [Verified via search]. Alpenglow is live on testnet only (since Sept 22); **mainnet date unannounced — do not depend on it** [Verified via search].
- **Breakpoint 2026 themes (prediction markets, AI agents):** https://solana.com/news/breakpoint-2026-london-speakers [Verified]
- **Wallet:** Phantom is a Grand Prize sponsor on the event page [Verified].
- **To research (not done):** current client SDK support for generating confidential-transfer proofs in a browser; Anchor + Token-2022 interplay; devnet vs mainnet feature gates.

### 4.4 Hyperliquid — execution and revenue
- **Official docs (not fetched):** https://hyperliquid.gitbook.io/hyperliquid-docs [Unverified link]
- **HIP-4 outcome markets background:**
  - https://www.dwellir.com/blog/hyperliquid-hip-4-mainnet-outcomes [Verified via search]
  - https://www.quicknode.com/blog/hyperliquid-hip-4-permissionless-deployment [Verified via search]
  - https://www.pyth.network/blog/hip-4-and-the-permissionless-era-of-outcome-markets [Verified via search]
- **Key facts** [secondary sources, verify against official docs]:
  - HIP-4 mainnet activated May 2, 2026; outcome markets run inside HyperCore on the shared order book.
  - **Deploying your own markets requires staking 500,000 HYPE for six months** → out of scope. Build the **trading front-end layer** only.
  - **Builder codes** let a front end route trades and charge a fee. Exact fee limits and rules: **unknown, read the official docs.**
- **Track wording:** "products that integrate with Hypercore or HyperEVM" [Verified in rules].

### 4.5 Robinhood Chain — "bet and hedge" with Stock Tokens
- **Building with Stock Tokens (official docs):** https://docs.robinhood.com/chain/building-with-stock-tokens/ [Verified, opened]
- **Mainnet launch and eligibility announcement (official):** https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/ [Verified, opened]
- **Prediction markets hub (Robinhood + Kalshi), context for the track's relevance:** https://robinhood.com/newsroom/robinhood-prediction-markets-hub [Verified via search]
- **Background coverage:**
  - Overview: https://www.dwellir.com/blog/what-is-robinhood-chain [Verified via search]
  - Testnet launch: https://finance.yahoo.com/news/robinhood-arbitrum-l2-chain-launches-124715466.html [Verified via search]
  - Uniswap liquidity data: https://cryptobriefing.com/uniswap-robinhood-chain-stock-token-volume-2/ [Verified via search; secondary source]
  - Uniswap launch post: https://blog.uniswap.org/robinhood-chain-is-live [Verified via search]
  - Eligibility/geofencing reporting: https://www.kucoin.com/news/flash/robinhood-chain-blocks-u-s-users-from-tokenized-stocks-but-ai-agents-may-bypass-restrictions [Verified via search; secondary source]
  - SEC context (Oct 2, 2026): https://www.theblock.co/news/regulation/2026-10-02-secs-innovation-exemption-robinhood-417538 [Verified via search]
- **Facts verified in official docs/newsroom:**
  - Robinhood Chain mainnet launched July 1, 2026; it is a permissionless environment for builders.
  - Stock Tokens are standard ERC-20 assets (18 decimals) with ERC-8056 scaled UI amounts, and can be held or transferred in any compatible wallet.
  - Regular users and developers trade on secondary venues: **0x RFQ, 1inch Fusion, LiFi (RFQ); Uniswap (AMM); Rialto (proprietary AMM); Lighter (orderbook, spot and perps)**.
  - Minting and burning is for **Authorized Participants with KYB onboarding** only. We cannot mint.
  - Every Stock Token has a per-asset **Chainlink price feed** implementing `AggregatorV3Interface`, 8 decimals.
  - Launch partners named: Uniswap, Pleiades, Alchemy, BitGo, Chainlink.
- **Facts from secondary sources (verify):** Arbitrum Orbit rollup, chain ID 4663, about 100 ms blocks, ETH gas; 450+ Stock Tokens; Uniswap around 99% of tokenized-stock DEX liquidity and $130M daily volume; testnet gives simulated stock tokens and test ETH.
- **Eligibility (official wording):** Stock Tokens are "not available in the US or to US persons and are subject to restrictions in other jurisdictions, including without limit Canada, the United Kingdom, Switzerland, UAE, and sanctioned jurisdictions." Available in more than 120 countries. The docs give **no on-chain allowlist or KYC detail** for ordinary holders. Enforcement appears to be front-end geofencing.
- **Hyperliquid equity markets check:** the live tracker https://hip4markets.com/ listed Sports, Crypto, Finance and Macro categories (276 markets) and **no equity or earnings-linked markets** [Verified, opened]. Explainers (e.g. https://www.coingecko.com/learn/hyperliquid-hip3-hip4-tokenized-stocks-and-prediction-markets) describe earnings markets as a viable category, not as listed. Hyperliquid's 30 "Finance" events were not itemized, so some index/stock markets may exist.
- **What we build:** a "bet and hedge" feature for macro/finance events: index-ETF Stock Token swapped through an open venue (Uniswap is the deepest), price shown from the Chainlink feed, receipt combined with the bet payout. Also an optional funding source from Robinhood Chain.
- **Stretch (leave for last):** host app-run earnings/price markets in the Solana program, resolved by Chainlink prices relayed from Robinhood Chain. Needs a signed relayer, which is a trust point.

### 4.6 Funding routes (Base / Arbitrum / Ethereum L1)
- **NEAR Intents** supports routes between ZEC and SOL, ETH, Arbitrum, Base and others [Verified via search; see SwapKit link above].
- Bridge/route from Tempo to Solana is **unconfirmed**. This is a design risk (section 6).

---

## 5. Architecture at a glance (to expand in the technical PRD)

```
[User: passkey on Tempo]──limit session──►[App backend / API]
        ▲                                        │
        │ payouts + memo receipts                │ route orders (builder code)
        │                                        ▼
[Zcash shielded payment + memo]──►[FROST relayer]──►[Solana confidential bankroll]──►[Hyperliquid outcome markets]
[Deposits from Base/Arb/ETH/SOL]─────────────────────────┘
[AI agent]──MPP session (capped)──►[App API: markets, data, orders]
[Macro/finance bet]──hedge leg──►[Robinhood Chain: Stock Token swap via Uniswap, Chainlink price feed]
```

Core components to specify in the PRD:
1. Frontend (mobile-first web app).
2. Backend/API and order router.
3. Tempo account + session/limit service.
4. Zcash relayer (viewing key, memo decoder, FROST group, ZEC float).
5. Solana Anchor settlement program + Token-2022 confidential mint.
6. Hyperliquid trading adapter (builder code).
7. Funding router (intents/bridge).
8. Receipts/proofs service.
9. Agent API.
10. Hedge service: Robinhood Chain swap adapter (Uniswap), Chainlink price reader, geofence gate.

---

## 6. Risks, limits and unknowns (state these honestly in the product and demo)

**What privacy does and doesn't cover**
- Confidential Balances hide **amounts and balances**, not accounts or participants.
- Once funds leave the confidential balance to trade on Hyperliquid, **positions there are public**. Privacy covers custody and inbound funding, not the trade itself.
- The Zcash shielded exit to other chains currently hits **transparent** addresses on the intents routes, so there is a visible hop. The memo-as-order flow hides the *instruction*, not every downstream leg.

**Robinhood Chain legal and eligibility limits**
- Stock Tokens are not available in the US or to US persons, and are restricted in Canada, the UK, Switzerland, UAE and sanctioned jurisdictions (official Robinhood wording). The hedge feature must be **geofenced and hidden** for those regions, in addition to the event's sanctions list.
- Do not build around front-end geoblocks or help users bypass them.
- **Demo on the testnet** with simulated Stock Tokens. If anyone on the team is a US person, they should not trade real Stock Tokens.
- The product's own geo/age policy for the betting side is a separate decision.
- No equity or earnings outcome markets were found on Hyperliquid, so the hedge covers macro/finance events only, using index-ETF Stock Tokens.

**Technical unknowns (spike first)**
1. Generating Confidential Balances proofs in a browser: SDK maturity and speed. **Highest risk.**
2. Zcash memo round trip in a relayer; FROST tooling maturity; ZEC float and rebalancing for payouts.
3. Tempo → Solana (and back) movement: is there a working mainnet route?
4. Tempo passkey + sponsored batched transaction; MPP session spend-limit behavior as a hard cap.
5. Hyperliquid builder-code terms and which outcome markets are tradable via API.
6. Tempo Zones availability.
7. Robinhood Chain testnet: which index-ETF Stock Tokens exist, Uniswap pool depth on testnet, Chainlink feed addresses, RPC/chain details (chain ID 4663 is from a secondary source).
8. Which Hyperliquid "Finance" and "Macro" markets exist and map cleanly to a Stock Token hedge.

**Product/legal**
- Prediction-market and betting regulation varies by jurisdiction. The event rules exclude sanctioned regions; the product's own geo and age policy needs a decision (Tempo's TIP-403 policy registry may help gate payouts).
- The Zcash relayer is a trust point even with FROST. Disclose it.

**Scope risk**
- Three chains in one flow is a lot to demo. Each hop must be obvious. If a chain's role can't be shown clearly, cut it rather than claim its track.

---

## 7. Hackathon strategy and prize map

Source: official rules, section 14 [Verified]: https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf · Event page: https://colosseum.com/worldsfair

| Prize line | Awards | Value | Our fit |
|---|---|---|---|
| Grand Champion | 1 | $30k (Phantom CASH stablecoin) | General pool |
| Next standout teams | 20 | $15k each | General pool |
| Public Goods | 1 | $5k | Open-source the funding router/relayer |
| University | 1 | $5k | Only if a team member qualifies |
| **Solana track** | 10 | $100k total | Strong (confidential custody, Anchor program, Phantom) |
| **Hyperliquid track** | 10 | $100k total | Strong (outcome markets, builder code) |
| **Tempo track** | 10 | $100k total | Strong (passkeys, sponsored fees, MPP limits, memos) |
| **Zcash track** | 10 | $100k total | Medium-strong (shielded memo-as-order, FROST relayer) |
| **Robinhood Chain** | 5 | $25k total | Medium ("bet and hedge" with Stock Tokens, Chainlink feed, open Uniswap venue; geofenced; testnet demo) |
| Base / Arbitrum / Ethereum L1 | 5 each | $25k each | Thin (deposit sources) |

- Per-track awards are described as "across N of the best products"; an even split per winner is **assumed**, not stated.
- **Judging criteria (shared):** Functionality/code quality; Potential impact (TAM); Novelty; UX; Open-source and composability; Business plan and team execution [Verified in rules, section 8].
- **Hard rules:** one team, one project submission at a time; every member must register on colosseum.com by the deadline; English content; winning requires prize-acceptance documents and due diligence [Verified].
- **Multi-track entry:** the builder has confirmed that one submission can enter several tracks. The public rules do not say so, so this is **builder-confirmed, not independently verified**. Re-check the submission form when you submit. The only public judging material is the shared rubric above; no track-specific criteria are published. If it turns out only one track is allowed, **pick Tempo** (the same product works; remove the others from the pitch).
- Business model for the "Business plan" criterion: **Hyperliquid builder-code fees** on routed volume, plus optional premium agent-API usage via MPP.

---

## 8. Suggested build order

1. **Spike (Oct 4–6):** (a) Confidential Balances in a browser; (b) Zcash memo round trip; (c) Tempo passkey + sponsored batched tx + MPP spend-limited session; (d) Hyperliquid builder-code trade.
2. **Core path:** Tempo account → fund → Solana confidential balance → Hyperliquid bet → Tempo payout.
3. **Differentiators:** Zcash memo-as-order, agent session, receipts/proofs.
4. **Robinhood hedge** (testnet): swap adapter, Chainlink price read, geofence gate, combined receipt.
5. **Thin tracks** (Base/Arbitrum/Ethereum deposit routes): only after the core works.
6. **Freeze scope Oct 11.** Use Oct 12 for the demo video, README, open-source cleanup and submission.

---

## 9. Evidence log

- Copilot data: 180 recorded winners across Renaissance, Radar, Breakout, Cypherpunk, Frontier (Solana-only corpus; winners exclude honorable mentions; categories auto-classified, two events classified from descriptions only). Past events' winners were roughly 1–3% of corpus projects (not a verified entrant denominator).
- Cypherpunk winners: https://blog.colosseum.com/announcing-the-winners-of-the-solana-cypherpunk-hackathon/
- Robinhood Chain research (Oct 4, 2026): official docs and newsroom opened; liquidity, chain ID and Stock Token count come from secondary sources. Hyperliquid equity-market check done via one live tracker only.
- Not done: ETHGlobal corpus queries; project-level competitor search for Hyperliquid outcome-market front ends and Zcash/Tempo hackathon apps; per-track entrant counts (unpublished).
- Many links above came from search results and were not all opened. Re-verify anything marked [Unverified] before relying on it.
