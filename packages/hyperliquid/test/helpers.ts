import { PrismaClient } from '@tyr/db';
import { featuredMarkets } from '../src/index.js';

export const db = new PrismaClient();

export function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`missing ${what}`);
  return v;
}

/** A tyr user row via the real WebAuthn registration path (Phase 2), no chain tx needed. */
export { registerUser } from '../../tempo/test/helpers.js';

export async function firstFeatured() {
  const m = (await featuredMarkets())[0];
  if (!m) throw new Error('no featured (live, unresolved, two-sided) outcome market on HL testnet');
  return m;
}
