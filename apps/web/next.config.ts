import path from "node:path";
import type { NextConfig } from "next";

// The browser only ever talks to this origin; /api/* is proxied to the Fastify API so the
// tyr_session cookie and the WebAuthn origin (http://localhost:3000) stay first-party.
const API_URL = process.env.TYR_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // pnpm hoists `next` to the monorepo root; point Turbopack there.
  turbopack: { root: path.join(__dirname, "../..") },
  // A routed bet runs a full chain saga per leg (Tempo + Solana + venue); allow it 5 minutes.
  experimental: { proxyTimeout: 300_000 },
  rewrites: async () => [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }],
};

export default nextConfig;
