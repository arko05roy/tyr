import path from "node:path";
import type { NextConfig } from "next";

// The browser only ever talks to this origin; /api/* is proxied to the Fastify API so the
// tyr_session cookie and the WebAuthn origin stay first-party.
// With no TYR_API_URL in a production build (e.g. Vercel), app/api/[...path] serves a mock API.
const API_URL =
  process.env.TYR_API_URL ?? (process.env.NODE_ENV === "production" ? undefined : "http://localhost:4000");
const MOCK = !API_URL;

// One codebase, two servers. "onboard" (:3000) is the landing, passkey sign-up, loss limit and
// deposit; "dashboard" (:3001) is the signed-in product: portfolio, markets, Zcash and agents.
// Cookies ignore the port, so a session made on :3000 is already signed in on :3001.
const SURFACE = process.env.NEXT_PUBLIC_TYR_SURFACE === "dashboard" ? "dashboard" : "onboard";
const ONBOARD_URL = process.env.NEXT_PUBLIC_TYR_ONBOARD_URL ?? "http://localhost:3000";
const DASHBOARD_URL = process.env.NEXT_PUBLIC_TYR_DASHBOARD_URL ?? "http://localhost:3001";

const DASHBOARD_PATHS = ["/portfolio", "/markets/:path*", "/zcash", "/agents", "/receipts/:path*"];
const ONBOARD_PATHS = ["/fund", "/onboarding/:path*"];

const nextConfig: NextConfig = {
  // Each surface gets its own build dir so both dev servers can run side by side.
  distDir: SURFACE === "dashboard" ? ".next-dashboard" : ".next",
  // pnpm hoists `next` to the monorepo root; point Turbopack there.
  turbopack: { root: path.join(__dirname, "../..") },
  // A routed bet runs a full chain saga per leg (Tempo + Solana + venue); allow it 5 minutes.
  experimental: { proxyTimeout: 300_000 },
  env: {
    NEXT_PUBLIC_TYR_SURFACE: SURFACE,
    NEXT_PUBLIC_TYR_ONBOARD_URL: ONBOARD_URL,
    NEXT_PUBLIC_TYR_DASHBOARD_URL: DASHBOARD_URL,
    NEXT_PUBLIC_TYR_MOCK: MOCK ? "1" : "",
  },
  redirects: async () =>
    SURFACE === "dashboard"
      ? [
          { source: "/", destination: "/portfolio", permanent: false },
          ...ONBOARD_PATHS.map((source) => ({ source, destination: `${ONBOARD_URL}${source}`, permanent: false })),
        ]
      : DASHBOARD_PATHS.map((source) => ({ source, destination: `${DASHBOARD_URL}${source}`, permanent: false })),
  // beforeFiles so the real API wins over the mock route handler when it is configured.
  rewrites: async () => ({
    beforeFiles: MOCK ? [] : [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }],
    afterFiles: [],
    fallback: [],
  }),
};

export default nextConfig;
