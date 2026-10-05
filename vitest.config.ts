import { defineConfig } from 'vitest/config';
import 'dotenv/config';

// All suites hit live testnets — generous timeouts, no parallel file runs that could race nonces.
export default defineConfig({
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'services/**/test/**/*.test.ts',
      'spikes/**/*.test.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
