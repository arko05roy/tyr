import { z } from 'zod';

const url = z.string().url();
const chainId = z.coerce.number().int().positive();

/**
 * Infra + RPC config needed by every service. Validated on boot; the process exits on any
 * missing or malformed var (PRD 0.2). Wallet keys are loaded by the packages that need them.
 */
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().startsWith('postgres'),
  REDIS_URL: z.string().startsWith('redis'),

  TEMPO_RPC_URL: url,
  TEMPO_CHAIN_ID: chainId,

  SOLANA_RPC_URL: url,

  ZCASH_LIGHTWALLETD_URL: z.string().min(1), // host:port (gRPC, TLS)

  HL_API_URL: url,

  ROBINHOOD_RPC_URL: url,
  ROBINHOOD_CHAIN_ID: chainId,

  SEPOLIA_RPC: url,
  BASE_SEPOLIA_RPC: url,
  ARB_SEPOLIA_RPC: url,
});

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

/** Load config or exit(1). Use at service entrypoints. */
export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    return loadConfig(env);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
