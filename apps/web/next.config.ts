import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pnpm hoists `next` to the monorepo root; point Turbopack there.
  turbopack: { root: path.join(__dirname, "../..") },
};

export default nextConfig;
