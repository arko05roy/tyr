// Paper execution against the REAL live HL testnet L2 book (owner sign-off 2026-10-05, docs/human-values.md).
// Walks actual book levels to compute a fill; never invents an oid or tx hash. Swap for real
// ExchangeClient orders once a funded HL testnet account exists.
import { info, outcomeCoin, type Book } from './hl.js';

export type PaperFill = {
  simulated: true;
  coin: string;
  side: 'buy' | 'sell';
  requestedSz: number;
  filledSz: number;
  avgPx: number;
  notionalUsd: number;
  builderFeeUsd: number;
  bookSnapshotAt: number;
  levelsConsumed: { px: number; sz: number }[];
};

/** IOC-style: consume opposite-side levels up to limitPx. */
export async function paperIoc(params: {
  outcome: number;
  outcomeSide: 0 | 1;
  side: 'buy' | 'sell';
  sz: number;
  limitPx: number;
  builderFeeTenthsBps: number;
}): Promise<PaperFill> {
  const coin = outcomeCoin(params.outcome, params.outcomeSide);
  const book = await info<Book & { time: number }>({ type: 'l2Book', coin });
  const levels = params.side === 'buy' ? book.levels[1] : book.levels[0];
  const crosses = (px: number) =>
    params.side === 'buy' ? px <= params.limitPx : px >= params.limitPx;

  let remaining = params.sz;
  const consumed: { px: number; sz: number }[] = [];
  for (const l of levels) {
    const px = Number(l.px);
    if (remaining <= 0 || !crosses(px)) break;
    const take = Math.min(remaining, Number(l.sz));
    consumed.push({ px, sz: take });
    remaining -= take;
  }
  const filledSz = consumed.reduce((s, l) => s + l.sz, 0);
  const notionalUsd = consumed.reduce((s, l) => s + l.px * l.sz, 0);
  return {
    simulated: true,
    coin,
    side: params.side,
    requestedSz: params.sz,
    filledSz,
    avgPx: filledSz ? notionalUsd / filledSz : 0,
    notionalUsd,
    builderFeeUsd: (notionalUsd * params.builderFeeTenthsBps) / 100_000,
    bookSnapshotAt: book.time,
    levelsConsumed: consumed,
  };
}
