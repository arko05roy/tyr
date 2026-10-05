// BullMQ settlement tick runs on real Redis against live HL testnet data.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@tyr/db';
import { createExecutor } from '@tyr/hyperliquid';
import { afterAll, describe, expect, it } from 'vitest';
import { startSettlement } from '../src/queues.js';

const db = new PrismaClient();
afterAll(() => db.$disconnect());

describe('settlement queue (Redis + live HL testnet)', () => {
  it('runs the repeatable tick to completion', async () => {
    const s = await startSettlement(db, createExecutor(), {
      redisUrl: process.env.REDIS_URL ?? '',
      everyMs: 60_000,
      queueName: `settlement-test-${randomUUID()}`,
    });
    try {
      const result = await new Promise<{ settled: string[] }>((ok, fail) => {
        s.worker.once('completed', (_j, r) => ok(r));
        s.worker.once('failed', (_j, e) => fail(e));
      });
      expect(Array.isArray(result.settled)).toBe(true);
    } finally {
      await s.close();
    }
  });
});
