// PRD 7.2/7.3 — memo codec round trip on shared vectors (TS here; the same file drives the Rust
// codec's `cargo test` in services/zcash-sidecar, which this suite also runs), + ZIP-321 URI.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoError, decodeMemo, encodeMemo, type OrderMemo } from '../src/memo.js';
import { formatZec, paymentUri } from '../src/zip321.js';

const vectors = JSON.parse(
  readFileSync(new URL('./memo-vectors.json', import.meta.url), 'utf8'),
) as {
  valid: (OrderMemo & { memo: string })[];
  invalid: string[];
};

describe('memo codec', () => {
  it('encodes and decodes every shared vector byte-for-byte', () => {
    for (const { memo, ...m } of vectors.valid) {
      expect(encodeMemo(m)).toBe(memo);
      expect(decodeMemo(memo)).toEqual(m);
      expect(Buffer.byteLength(memo)).toBeLessThanOrEqual(512);
    }
  });

  it('rejects every invalid vector', () => {
    for (const bad of vectors.invalid) expect(() => decodeMemo(bad), bad).toThrow(MemoError);
  });

  it('tolerates the zero padding a wallet may leave on a 512-byte memo', () => {
    const [first] = vectors.valid;
    if (!first) throw new Error('no vectors');
    const { memo, ...m } = first;
    expect(decodeMemo(memo + '\0'.repeat(20))).toEqual(m);
  });

  it('Rust codec agrees (cargo test)', () => {
    const out = execFileSync('cargo', ['test', '--release', '--lib', 'memo'], {
      cwd: new URL('../../../services/zcash-sidecar', import.meta.url).pathname,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: new URL('../../../.tools/src/zingolib/target', import.meta.url).pathname,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toMatch(/shared_vectors \.\.\. ok/);
  }, 600_000);
});

describe('ZIP-321', () => {
  it('formats ZEC amounts without float error', () => {
    expect(formatZec(1n)).toBe('0.00000001');
    expect(formatZec(123_000_000n)).toBe('1.23');
    expect(formatZec(500_000_000n)).toBe('5');
  });

  it('builds a request with a base64url memo', () => {
    const memo = vectors.valid[0]?.memo ?? '';
    const uri = paymentUri('uregtest1abc', 1_900_000n, memo);
    expect(uri).toBe(
      `zcash:uregtest1abc?amount=0.019&memo=${Buffer.from(memo).toString('base64url')}`,
    );
  });
});
