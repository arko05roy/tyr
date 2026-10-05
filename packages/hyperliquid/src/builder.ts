// PRD 4.2 / Stop 4: builder code attached to every order. Values in docs/human-values.md.
import type { Address } from 'viem';

export type BuilderCode = { b: Address; f: number };

export function builderCode(): BuilderCode {
  const b = process.env.TYR_BUILDER_ADDRESS;
  if (!b || !/^0x[0-9a-fA-F]{40}$/.test(b)) throw new Error('TYR_BUILDER_ADDRESS missing (Stop 4)');
  const f = Number(process.env.TYR_BUILDER_FEE_TENTHS_BPS ?? '10');
  // HL caps builder fees at 0.1% perps / 1% spot; outcome markets trade as spot-like assets.
  if (!Number.isInteger(f) || f < 0 || f > 100) throw new Error(`bad builder fee ${f}`);
  return { b: b as Address, f };
}

/** fee in USD for a notional at f tenths-of-bps. */
export const builderFeeUsd = (notionalUsd: number, f: number) => (notionalUsd * f) / 100_000;
