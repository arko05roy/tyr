// PRD 11: typed client for the tyr API. Types are generated from services/api/openapi.yaml
// (`pnpm --filter @tyr/api openapi` regenerates both); never edit schema.ts by hand.
import createFetchClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths } from './schema.js';

export type Schemas = components['schemas'];
export type ApiError = Schemas['Error'];
export type Order = Schemas['Order'];
export type Settlement = Schemas['Settlement'];
export type Deposit = Schemas['Deposit'];
export type Market = Schemas['Market'];
export type MarketDetail = Schemas['MarketDetail'];
export type Hedge = Schemas['Hedge'];
export type ReceiptSummary = Schemas['ReceiptSummary'];
export type Verification = Schemas['Verification'];
export type Proof = Schemas['Proof'];
/** Messages pushed on GET /ws. */
export type WsEvent = Schemas['WsEvent'];

/**
 * Session-authenticated client. In the browser the `tyr_session` cookie rides along
 * (credentials: 'include'); pass `baseUrl` when the API is on another origin.
 */
export function createTyrClient(opts: ClientOptions = {}) {
  return createFetchClient<paths>({ credentials: 'include', ...opts });
}

export type TyrClient = ReturnType<typeof createTyrClient>;

/** ws(s):// URL of the event stream for an http(s) API base URL. */
export const wsUrl = (baseUrl: string) => `${baseUrl.replace(/^http/, 'ws')}/ws`;
