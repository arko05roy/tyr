// S4b: on Hyperliquid TESTNET, with builder code {b, f}:
//   1. master approves builder fee (one-time)
//   2. agent places a resting YES bid far from mid → cancel → status canceled
//   3. agent places a marketable IOC → fill → userFills shows builderFee > 0
// Needs HUMAN STOP 1/4 values: HL_MASTER_PRIVATE_KEY, HL_AGENT_PRIVATE_KEY, TYR_BUILDER_ADDRESS.
import 'dotenv/config';
import { ExchangeClient, HttpTransport } from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';
import { info, liveOutcomes, outcomeAssetId, outcomeCoin } from './hl.js';

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k} (HUMAN STOP 1/4 — see docs/tyr-prd.md)`);
  return v;
}
const master = privateKeyToAccount(need('HL_MASTER_PRIVATE_KEY') as `0x${string}`);
const agent = privateKeyToAccount(need('HL_AGENT_PRIVATE_KEY') as `0x${string}`);
const builder = need('TYR_BUILDER_ADDRESS') as `0x${string}`;
const feeTenthsBps = Number(process.env.TYR_BUILDER_FEE_TENTHS_BPS ?? '10'); // 10 = 1bp

const transport = new HttpTransport({ isTestnet: true });
const asMaster = new ExchangeClient({ transport, wallet: master });
const asAgent = new ExchangeClient({ transport, wallet: agent });
const builderField = { b: builder, f: feeTenthsBps };

console.log('master', master.address, 'agent', agent.address, 'builder', builder);
console.log(
  '1. approveBuilderFee',
  await asMaster.approveBuilderFee({ builder, maxFeeRate: `${feeTenthsBps / 1000}%` }),
);

const { live } = await liveOutcomes(1);
const target = live[0];
if (!target) throw new Error('no live outcome book on testnet right now');
const { outcome } = target.outcome;
const a = outcomeAssetId(outcome, 0);
console.log(
  `target outcome ${outcome} (${outcomeCoin(outcome, 0)}) asset ${a}: ${target.outcome.description}`,
);

// 2. resting far-from-mid bid → cancel
const rest = await asAgent.order({
  orders: [{ a, b: true, p: '0.01', s: '1000', r: false, t: { limit: { tif: 'Gtc' } } }],
  grouping: 'na',
  builder: builderField,
});
const restStatus = rest.response.data.statuses[0] as { resting?: { oid: number } };
const oid = restStatus.resting?.oid;
if (!oid) throw new Error(`expected resting order, got ${JSON.stringify(rest)}`);
console.log('2. resting oid', oid);
console.log('   cancel', JSON.stringify(await asAgent.cancel({ cancels: [{ a, o: oid }] })));
console.log(
  '   status',
  JSON.stringify(await info({ type: 'orderStatus', user: master.address, oid })),
);

// 3. marketable IOC at best ask for ≥ $10 notional
const book = await info<{ levels: [{ px: string }[], { px: string; sz: string }[]] }>({
  type: 'l2Book',
  coin: outcomeCoin(outcome, 0),
});
const ask = book.levels[1][0]!;
const size = Math.min(Number(ask.sz), Math.ceil(11 / Number(ask.px)));
const ioc = await asAgent.order({
  orders: [{ a, b: true, p: ask.px, s: String(size), r: false, t: { limit: { tif: 'Ioc' } } }],
  grouping: 'na',
  builder: builderField,
});
console.log('3. IOC', JSON.stringify(ioc.response.data.statuses));
const fills = await info<
  { coin: string; oid: number; builderFee?: string; px: string; sz: string; hash: string }[]
>({
  type: 'userFills',
  user: master.address,
});
const mine = fills.filter((f) => f.coin === outcomeCoin(outcome, 0)).slice(0, 3);
console.log('   fills', JSON.stringify(mine, null, 2));
if (!mine.some((f) => Number(f.builderFee ?? 0) > 0))
  throw new Error('✗ no fill with builderFee > 0');
console.log('✓ S4 PASS');
