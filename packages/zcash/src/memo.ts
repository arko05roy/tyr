// PRD 7.2 — tyr order memo codec (TS twin of services/zcash-sidecar/src/memo.rs; shared vectors in
// test/memo-vectors.json are checked by both `vitest` and `cargo test`).
//
// Binary v1 (big-endian):
//   version u8 = 1 | outcome u32 | side u8 (0 yes, 1 no) | sizeCents u32 |
//   uaLen u8 | returnUA (ascii) | nonce [8] | checksum [4] = sha256(all prior bytes)[0..4]
// Carried as a text memo: "tyr1:" + base64url(binary, no padding). ≤ 512 bytes.
import { createHash } from 'node:crypto';

export const MEMO_PREFIX = 'tyr1:';

export type OrderMemo = {
  outcome: number;
  side: 0 | 1;
  sizeCents: number;
  returnUA: string;
  /** 8 bytes, hex */
  nonce: string;
};

export class MemoError extends Error {}

const sum4 = (b: Buffer) => createHash('sha256').update(b).digest().subarray(0, 4);

export function encodeMemo(m: OrderMemo): string {
  const ua = Buffer.from(m.returnUA, 'ascii');
  const nonce = Buffer.from(m.nonce, 'hex');
  if (m.side !== 0 && m.side !== 1) throw new MemoError('side must be 0 or 1');
  if (!/^[\x21-\x7e]{1,255}$/.test(m.returnUA))
    throw new MemoError('return UA must be 1..255 ascii');
  if (nonce.length !== 8) throw new MemoError('nonce must be 8 bytes');
  for (const [k, v] of [
    ['outcome', m.outcome],
    ['sizeCents', m.sizeCents],
  ] as const)
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff)
      throw new MemoError(`${k} out of u32 range`);
  const head = Buffer.alloc(11);
  head.writeUInt8(1, 0);
  head.writeUInt32BE(m.outcome, 1);
  head.writeUInt8(m.side, 5);
  head.writeUInt32BE(m.sizeCents, 6);
  head.writeUInt8(ua.length, 10);
  const payload = Buffer.concat([head, ua, nonce]);
  const text = MEMO_PREFIX + Buffer.concat([payload, sum4(payload)]).toString('base64url');
  if (Buffer.byteLength(text) > 512) throw new MemoError('memo exceeds 512 bytes');
  return text;
}

export function decodeMemo(text: string): OrderMemo {
  const t = text.replace(/\0+$/, '');
  if (!t.startsWith(MEMO_PREFIX)) throw new MemoError('not a tyr memo');
  const body = t.slice(MEMO_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new MemoError('bad base64url');
  const b = Buffer.from(body, 'base64url');
  if (b.length < 11 + 8 + 4) throw new MemoError('memo too short');
  const payload = b.subarray(0, b.length - 4);
  if (!sum4(payload).equals(b.subarray(b.length - 4))) throw new MemoError('bad checksum');
  if (payload[0] !== 1) throw new MemoError(`unsupported memo version ${payload[0]}`);
  const side = payload.readUInt8(5);
  if (side > 1) throw new MemoError('bad side');
  const uaLen = payload.readUInt8(10);
  if (payload.length !== 11 + uaLen + 8) throw new MemoError('length mismatch');
  return {
    outcome: payload.readUInt32BE(1),
    side: side as 0 | 1,
    sizeCents: payload.readUInt32BE(6),
    returnUA: payload.subarray(11, 11 + uaLen).toString('ascii'),
    nonce: payload.subarray(11 + uaLen).toString('hex'),
  };
}
