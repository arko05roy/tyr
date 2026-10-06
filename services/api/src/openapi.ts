// PRD 11: writes openapi.yaml from the registered routes' zod schemas. The contract test fails if
// the committed file drifts from what the code generates. Usage: pnpm --filter @tyr/api openapi
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@tyr/db';
import { stringify } from 'yaml';
import { buildApp } from './app.js';

export const SPEC_PATH = fileURLToPath(new URL('../openapi.yaml', import.meta.url));

/** The spec as YAML. Builds the app (no DB connection, no listen) to read its routes. */
export async function generateSpec(): Promise<string> {
  const db = new PrismaClient();
  const app = await buildApp({ db, cookieSecret: 'openapi-generation' });
  await app.ready();
  // YAML 1.1 output quotes "yes"/"no" (the bet sides) so no parser reads them as booleans.
  const yaml = stringify(app.swagger(), { version: '1.1', lineWidth: 0 });
  await app.close();
  await db.$disconnect();
  return yaml;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadDotenv({ path: new URL('../../../.env', import.meta.url) });
  writeFileSync(SPEC_PATH, await generateSpec());
  console.log(`wrote ${SPEC_PATH}`);
}
