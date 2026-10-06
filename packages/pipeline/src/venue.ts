// Phase 11b: one venue registry for the pipeline. Hyperliquid orders keep the Phase 4 executor path
// (paper or live, builder code, ledger); every other venue executes through its adapter, and its
// fills are persisted on the same Order row with simulated = true while the adapter is simulated.
import type { PrismaClient } from '@tyr/db';
import {
  defaultRegistry,
  marketId,
  parseMarketId,
  type Fill,
  type OrderRequest,
  type VenueRegistry,
} from '@tyr/venues';

let registry: VenueRegistry | undefined;
export const venues = () => (registry ??= defaultRegistry());
/** tests inject a registry with a fixed clock */
export const setVenues = (r: VenueRegistry) => {
  registry = r;
};

/** `outcome` (legacy HL id) or a venue market id → canonical `venue:nativeId`. */
export function resolveMarketId(input: {
  marketId?: string | undefined;
  outcome?: number | undefined;
}) {
  if (input.marketId) {
    parseMarketId(input.marketId);
    return input.marketId;
  }
  if (input.outcome === undefined) throw new Error('bet needs marketId or outcome');
  return marketId('hyperliquid', String(input.outcome));
}

export const isHl = (id: string) => parseMarketId(id).venue === 'hyperliquid';
export const hlOutcome = (id: string) => Number(parseMarketId(id).nativeId);

export const fillFields = (f: Fill) => ({
  filledSize: f.filledSz,
  avgPx: f.filledSz ? f.avgPx : null,
  // venue fee for non-HL fills (HL rows carry the builder fee here); both count as entry cost
  builderFee: f.feeUsd,
  status: f.status,
  simulated: f.simulated,
  execution: f as unknown as object,
});

/** Persist a venue order that is not part of the bet saga (close-at-mark sells). */
export async function placeVenueOrder(
  db: PrismaClient,
  userId: string,
  req: OrderRequest,
  link: { parentId?: string } = {},
) {
  const { venue } = parseMarketId(req.marketId);
  const f = await venues().venue(venue).execute(req);
  return db.order.create({
    data: {
      userId,
      marketId: req.marketId,
      side: req.side,
      isBuy: req.isBuy ?? true,
      tif: 'Ioc',
      size: req.sz,
      price: req.limitPx,
      ...fillFields(f),
      parentId: link.parentId ?? null,
    },
  });
}
