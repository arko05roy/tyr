import { keccak256, toHex, type Hex } from 'viem';

/** PRD 2.5: memo32 = keccak256(settlementId) — already exactly 32 bytes. */
export const memo32 = (settlementId: string): Hex => keccak256(toHex(settlementId));
