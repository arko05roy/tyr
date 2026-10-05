// Phase 4 routes over real HTTP, backed by live HL testnet data.
import { PrismaClient } from '@tyr/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const db = new PrismaClient();
let base = '';
let close: () => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed JSON in assertions
const json = (r: Response): Promise<any> => r.json();

beforeAll(async () => {
  const app = await buildApp({ db, cookieSecret: process.env.TYR_SECRETS_KEY ?? '' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  close = () => app.close();
});
afterAll(async () => {
  await close();
  await db.$disconnect();
});

describe('api.hl (live HL testnet)', () => {
  it('GET /api/markets → featured markets; /:id → books', async () => {
    const { markets } = await json(await fetch(`${base}/api/markets`));
    expect(markets.length).toBeGreaterThan(0);
    const d = await json(await fetch(`${base}/api/markets/${markets[0].outcome}`));
    expect(d.books.yes.levels[1].length).toBeGreaterThan(0);
    expect((await fetch(`${base}/api/markets/999999999`)).status).toBe(404);
  });

  it('GET /api/admin/revenue requires the admin token', async () => {
    expect((await fetch(`${base}/api/admin/revenue`)).status).toBe(401);
    const res = await fetch(`${base}/api/admin/revenue`, {
      headers: { authorization: `Bearer ${process.env.TYR_ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const rev = await json(res);
    expect(rev.builder.toLowerCase()).toBe(process.env.TYR_BUILDER_ADDRESS?.toLowerCase());
    expect(rev.feeTenthsBps).toBe(10);
    expect(rev.ledger.simulated.feesUsd).toBeGreaterThan(0); // from hl.order.test
  });
});
