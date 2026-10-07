// PRD 12 gate: sign up → set limit → fund (devnet) → bet → see settlement, in a real browser,
// with Chromium's virtual WebAuthn authenticator (CDP) standing in for a fingerprint.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const root = path.resolve(__dirname, "../../..");
const server = (...args: string[]) =>
  JSON.parse(
    execFileSync("pnpm", ["exec", "tsx", "services/api/test/webE2e.ts", ...args], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .pop()!,
  );

test("passkey signup → loss limit → fund → routed bet → settlement", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // 1. sign up with a passkey
  await page.goto("/start");
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page).toHaveURL(/\/onboarding\/limit/);

  // 2. $60/day loss limit, authorized on Tempo by the passkey (fee sponsored)
  await page.getByLabel("Amount (USD)").fill("60");
  await page.getByRole("button", { name: /^Set \$60 \/ day$/ }).click();
  await expect(page).toHaveURL(/\/fund/, { timeout: 180_000 });

  // 3. fund: the server-side leg mints a confidential bankroll on devnet
  const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
  server("fund", me.tempoAddress, "80");
  await page.reload();
  await expect(page.getByText("$80.00").first()).toBeVisible();

  // 4. routed bet on a multi-venue event that doesn't need Hyperliquid
  const { events } = await page.evaluate(() =>
    fetch("/api/venues/events?multiVenue=true").then((r) => r.json()),
  );
  const ev = events.find((e: { venues: { venue: string }[] }) => e.venues.every((v) => v.venue !== "hyperliquid"));
  await page.goto(`/markets/${encodeURIComponent(ev.eventKey)}`);
  await expect(page.getByText(/Best route/)).toBeVisible();
  await page.getByLabel("Stake (USD)").fill("20");
  await page.getByRole("button", { name: /^Bet \$20 on YES$/ }).click();
  await expect(page).toHaveURL(/\/portfolio/, { timeout: 300_000 });
  await expect(page.getByText("Filled").first()).toBeVisible();

  // 5. settle (real close at mark + Solana settle + Tempo memo payout) and watch it land
  const { bets } = await page.evaluate(() => fetch("/api/bets").then((r) => r.json()));
  for (const b of bets) server("settle", b.id);
  await page.reload();
  await expect(page.getByText(/closed · paid/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Tempo payout/ }).first()).toBeVisible();
});
