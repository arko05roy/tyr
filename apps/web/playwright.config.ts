import { defineConfig } from "@playwright/test";

// PRD 12: runs against the real backend on testnets. Start the API (:4000) and the
// workers first; the web app is started here. Run before every demo recording.
export default defineConfig({
  testDir: "e2e",
  timeout: 15 * 60_000,
  expect: { timeout: 120_000 },
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm next dev -p 3000",
    url: "http://localhost:3000/markets",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
