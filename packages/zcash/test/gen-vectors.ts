// Regenerate shared memo vectors: pnpm tsx packages/zcash/test/gen-vectors.ts
// Valid vectors are produced by the TS encoder; `cargo test` in services/zcash-sidecar asserts the
// Rust codec produces byte-identical memos and rejects every invalid one.
import { writeFileSync } from 'node:fs';
import { encodeMemo, type OrderMemo } from '../src/memo.js';

const UA_REGTEST =
  'uregtest1lsg9ypg8r478vmv226f7je53c6de7w9lq5d974t0jcnu7nhjlk27h63egwvycjafrt75cneg8q3af0ck5t6rtc55p0nrrz436vexnc5u';
const inputs: OrderMemo[] = [
  { outcome: 6320, side: 0, sizeCents: 2500, returnUA: UA_REGTEST, nonce: '0001020304050607' },
  { outcome: 0, side: 1, sizeCents: 0, returnUA: 'u1x', nonce: 'ffffffffffffffff' },
  {
    outcome: 0xffffffff,
    side: 1,
    sizeCents: 0xffffffff,
    returnUA: 'utest1' + 'q'.repeat(249),
    nonce: 'a1b2c3d4e5f60718',
  },
];
const valid = inputs.map((m) => ({ ...m, memo: encodeMemo(m) }));
const good = valid[0]?.memo ?? '';
const raw = Buffer.from(good.slice(5), 'base64url');
const flip = (i: number) => {
  const b = Buffer.from(raw);
  b.writeUInt8(b.readUInt8(i) ^ 1, i);
  return 'tyr1:' + b.toString('base64url');
};
const invalid = [
  '',
  'hello',
  'tyr2:' + good.slice(5),
  'tyr1:',
  'tyr1:!!!',
  flip(3), // payload byte → checksum mismatch
  flip(raw.length - 1), // checksum byte
  'tyr1:' + raw.subarray(0, raw.length - 1).toString('base64url'), // truncated
];
writeFileSync(
  new URL('./memo-vectors.json', import.meta.url),
  JSON.stringify({ valid, invalid }, null, 2) + '\n',
);
console.log(`${valid.length} valid, ${invalid.length} invalid vectors`);
