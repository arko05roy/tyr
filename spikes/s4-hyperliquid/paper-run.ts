// S4b (simulated execution): marketable buy of ~$11 YES on a live testnet outcome via the real book.
import { liveOutcomes } from './hl.js';
import { paperIoc } from './paper.js';

const { live } = await liveOutcomes(1);
const t = live[0];
if (!t) throw new Error('no live outcome book');
const ask = Number(t.book.levels[1][0]!.px);
const fill = await paperIoc({
  outcome: t.outcome.outcome,
  outcomeSide: 0,
  side: 'buy',
  sz: Math.ceil(11 / ask),
  limitPx: ask,
  builderFeeTenthsBps: 10,
});
console.log(t.outcome.description);
console.log(JSON.stringify(fill, null, 2));
if (!fill.simulated || fill.filledSz <= 0) throw new Error('✗ no paper fill');
console.log('✓ S4b PASS (simulated execution, live book)');
