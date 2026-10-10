# Demo script

About 3 minutes. Two parts: a live run on **localhost:3000** (sign up, limit, deposit), then a cut to
**localhost:3001** (the account after some use: portfolio, markets, Zcash, agents).

**Do** = what you click. **Say** = what you say, roughly word for word.

---

## Before you record

- [ ] Docker is running, then `pnpm dev` from the repo root (starts both web servers, the API and the workers).
- [ ] Open three tabs: `localhost:3000`, `localhost:3001/portfolio`, and the Tempo explorer.
- [ ] Delete old `localhost` passkeys in your browser or password manager, so sign-up starts clean.
- [ ] Have a funded devnet USDC wallet ready for the deposit (or use the Tempo AlphaUSD tab).
- [ ] Browser zoom at 110%, notifications off, bookmarks bar hidden.

---

## Part 1: Onboarding (localhost:3000), about 75 seconds

### 1. Landing (15s)

**Do:** Open `localhost:3000`. Scroll slowly through "The problem" and "How Tyr works".

**Say:** "Prediction markets have three problems. Everything is public: your balance, your bets, your
wallet history. They're annoying: you need a wallet, the right chain, gas and a seed phrase. And
liquidity is split across a lot of venues. Tyr fixes all three."

### 2. Sign up with a passkey (15s)

**Do:** Click **Get Started**, then **Create account with passkey**. Touch your fingerprint.

**Say:** "That's the whole sign-up. One fingerprint. The passkey _is_ my account on Tempo. No email,
no seed phrase, and I never paid gas."

### 3. Set a loss limit (20s)

**Do:** On "Set a limit you can't break", pick **day** and **$50**, click **Set $50 / day** and confirm with the passkey. Click
**Authorization on Tempo ↗** to show the transaction.

**Say:** "Before I can bet, I set a loss limit. This isn't a setting in our database. My passkey signs
a Tempo access key with a spend cap, so the chain itself rejects any stake past fifty dollars a day,
whether the stake comes from me, from Tyr, or from an AI agent."

### 4. Deposit (25s)

**Do:** On "Fund it from any chain", show the chain tabs (Solana, Tempo, Sepolia / Base / Arbitrum /
Robinhood). Send USDC to the Solana address. Wait for the row to reach **In your hidden balance**.

**Say:** "I can fund from whatever chain I already use. The money lands as a confidential balance on
Solana: on the explorer the amount is encrypted. Only I can decrypt it, here in the app."

**Do:** Click **Open dashboard →** in the header.

---

## The cut

**Say:** "Let's skip ahead a couple of weeks, to an account that's been in use for a while."

Switch to the `localhost:3001` tab. (You're still signed in: the session carries over.)

---

## Part 2: The dashboard (localhost:3001), about 100 seconds

### 5. Portfolio: Your book (25s)

**Do:** Point at the four cards, then click **Decrypt for me** on the hidden balance.

**Say:** "This is my book. The balance stays hidden until I decrypt it, for my eyes only. I have about
a hundred dollars at risk across four open bets, I'm up on what's settled, and here's how much of
today's loss limit is left, enforced on Tempo."

**Do:** Scroll to **Exposure by venue** and **Activity**.

**Say:** "My bets are spread over Hyperliquid, Polymarket, Kalshi and Limitless, but I never picked a
venue. Tyr did. Deposits came from Solana, Base and Tempo. And every settled bet leaves a receipt I
can keep private or share."

### 6. Markets (25s)

**Do:** Open **Markets**. Filter to **crypto**. Point at a card where venues disagree.

**Say:** "Here's why the routing matters. The same question is listed on several venues at different
prices. Tyr shows them side by side and routes my stake to the cheapest all-in price. Here the venues
disagree by a few cents, and that difference is mine."

**Do:** Open one market and show the per-venue table.

### 7. Zcash: the payment is the order (25s)

**Do:** Open **Zcash**. Point at the four steps, then **Inside the memo**, then **Your shielded orders**
and **Payout quorum**.

**Say:** "This is the most private way in. No account at all. I send shielded Zcash, and the encrypted
memo on the payment _is_ the order: market, side, size and my return address, packed into these bytes.
On-chain nobody sees the amount, the sender or the bet. When it settles, I get paid back in shielded
ZEC, and no single key can move the money: two of three FROST signers have to approve every payout."

### 8. Agents (25s)

**Do:** Open **Agents**. Point at the sessions with their spending bars, then **Recent paid calls**.

**Say:** "Last: AI agents. I gave my trading bots their own keys, each with a budget my passkey signed.
Every paid API call answers with HTTP 402, and the agent pays a cent on Tempo before it gets the data.
`edge-hunter` has used about thirty of its fifty a day. `news-scraper` hit its cap, and once it did,
its payments simply failed on-chain. An agent can't overspend, even if it goes rogue."

---

## Close (10s)

**Do:** Open **What's private here?** in the bottom right.

**Say:** "Private where it matters, honest about where it isn't. A fingerprint to sign up, a limit
the chain enforces, the best price across every venue. That's Tyr."

---

## If something breaks

| Problem                      | Fix                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Passkey prompt never appears | Check the API is running and you're on `localhost`, not `127.0.0.1`.              |
| Deposit is slow to credit    | Keep talking through the explorer view, then do the cut. Portfolio is pre-filled. |
| 3001 asks you to sign in     | Click **Sign in** and use the passkey; both ports accept it.                      |
| Markets list is empty        | The API can't reach the venues. Skip to Zcash.                                    |

## Note on the dashboard data

When your account has no real activity, the dashboard on 3001 shows demo data from
`apps/web/app/_app/demo.ts` (balance, bets, deposits, receipts, agent sessions, Zcash orders). Real
data replaces it as soon as it exists. If a judge asks, say so plainly: the 3001 view is an
illustrative account; the onboarding on 3000 is live on testnet.
