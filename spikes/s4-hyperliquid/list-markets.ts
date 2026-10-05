// S4a: list tradable HIP-4 outcome markets on Hyperliquid TESTNET with live books.
import { liveOutcomes, outcomeAssetId, parseTemplate } from './hl.js';

const { total, live } = await liveOutcomes(15);
console.log(
  `outcomeMeta: ${total} outcomes on testnet; ${live.length} with two-sided YES books:\n`,
);
for (const { outcome: o, book } of live) {
  const t = parseTemplate(o.description);
  const label = t ? `${o.name} ${JSON.stringify(t)}` : `${o.name} — ${o.description.slice(0, 80)}`;
  console.log(
    `#${o.outcome} asset=${outcomeAssetId(o.outcome, 0)} bid ${book.levels[0][0]!.px} / ask ${book.levels[1][0]!.px}  ${label}`,
  );
}
