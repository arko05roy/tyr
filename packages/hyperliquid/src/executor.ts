// PRD 4.2: one interface, two executors.
//   live  — signed orders to HL testnet via the approved agent key (needs testnet USDC in the float)
//   paper — owner-approved deviation (docs/human-values.md 2026-10-05): fills computed by walking
//           the REAL live testnet book. Never invents an oid or hash; results carry simulated: true.
import { ExchangeClient, HttpTransport } from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { outcomeAssetId, outcomeCoin, type OutcomeSide } from './assets.js';
import { builderCode, builderFeeUsd } from './builder.js';
import { l2Book, orderStatus, userFills } from './info.js';

export type OrderRequest = {
  outcome: number;
  side: OutcomeSide;
  isBuy: boolean;
  sz: number;
  limitPx: number;
  tif: 'Ioc' | 'Gtc';
};

export type ExecStatus = 'filled' | 'partial' | 'resting' | 'canceled' | 'rejected';

export type ExecResult = {
  simulated: boolean;
  status: ExecStatus;
  oid?: number | undefined;
  filledSz: number;
  avgPx: number;
  notionalUsd: number;
  builderFeeUsd: number;
  error?: string;
  /** paper only: proof of what book the fill was computed against */
  book?: { snapshotAt: number; levelsConsumed: { px: number; sz: number }[] };
  /** live only: real fill hashes */
  fillHashes?: string[];
};

export interface Executor {
  readonly mode: 'live' | 'paper';
  place(req: OrderRequest): Promise<ExecResult>;
  /** live: cancels on HL. paper: resting orders exist only in tyr's ledger, so this is a no-op ack. */
  cancel(req: {
    outcome: number;
    side: OutcomeSide;
    oid?: number | undefined;
  }): Promise<{ ok: boolean }>;
}

/** HL rejects any order whose value (sz × limit px) is below $10 — paper mode mirrors the venue. */
export const MIN_ORDER_USD = 10;

const rejected = (simulated: boolean, error: string): ExecResult => ({
  simulated,
  status: 'rejected',
  filledSz: 0,
  avgPx: 0,
  notionalUsd: 0,
  builderFeeUsd: 0,
  error,
});

const statusOf = (filled: number, requested: number): ExecStatus =>
  filled <= 0 ? 'canceled' : filled + 1e-9 >= requested ? 'filled' : 'partial';

export class PaperExecutor implements Executor {
  readonly mode = 'paper' as const;

  async place(req: OrderRequest): Promise<ExecResult> {
    const { f } = builderCode();
    if (req.sz * req.limitPx < MIN_ORDER_USD)
      return rejected(true, `Order must have minimum value of $${MIN_ORDER_USD}`);
    const book = await l2Book(outcomeCoin(req.outcome, req.side));
    const levels = req.isBuy ? book.levels[1] : book.levels[0];
    const crosses = (px: number) => (req.isBuy ? px <= req.limitPx : px >= req.limitPx);

    let remaining = req.sz;
    const consumed: { px: number; sz: number }[] = [];
    for (const l of levels) {
      const px = Number(l.px);
      if (remaining <= 1e-12 || !crosses(px)) break;
      const take = Math.min(remaining, Number(l.sz));
      consumed.push({ px, sz: take });
      remaining -= take;
    }
    const filledSz = consumed.reduce((s, l) => s + l.sz, 0);
    const notionalUsd = consumed.reduce((s, l) => s + l.px * l.sz, 0);
    let status = statusOf(filledSz, req.sz);
    // A Gtc that doesn't fully cross rests (in tyr's ledger only — nothing is posted to HL).
    if (req.tif === 'Gtc' && status !== 'filled') status = filledSz > 0 ? 'partial' : 'resting';
    return {
      simulated: true,
      status,
      filledSz,
      avgPx: filledSz ? notionalUsd / filledSz : 0,
      notionalUsd,
      builderFeeUsd: builderFeeUsd(notionalUsd, f),
      book: { snapshotAt: book.time, levelsConsumed: consumed },
    };
  }

  async cancel() {
    return { ok: true };
  }
}

const fmt = (n: number) => String(Number(n.toPrecision(5)));

export class LiveExecutor implements Executor {
  readonly mode = 'live' as const;
  private readonly agent: ExchangeClient;
  private readonly master: Hex;

  constructor() {
    const masterKey = process.env.HL_MASTER_PRIVATE_KEY as Hex | undefined;
    const agentKey = process.env.HL_AGENT_PRIVATE_KEY as Hex | undefined;
    if (!masterKey || !agentKey)
      throw new Error('HL_MASTER_PRIVATE_KEY / HL_AGENT_PRIVATE_KEY missing');
    this.master = privateKeyToAccount(masterKey).address;
    this.agent = new ExchangeClient({
      transport: new HttpTransport({ isTestnet: true }),
      wallet: privateKeyToAccount(agentKey),
    });
  }

  /** One-time per master/sub-account: master signs approval for tyr's builder. */
  static async approveBuilderFee() {
    const { b, f } = builderCode();
    const master = new ExchangeClient({
      transport: new HttpTransport({ isTestnet: true }),
      wallet: privateKeyToAccount(process.env.HL_MASTER_PRIVATE_KEY as Hex),
    });
    return master.approveBuilderFee({ builder: b, maxFeeRate: `${f / 1000}%` });
  }

  async place(req: OrderRequest): Promise<ExecResult> {
    const { b, f } = builderCode();
    try {
      const res = await this.agent.order({
        orders: [
          {
            a: outcomeAssetId(req.outcome, req.side),
            b: req.isBuy,
            p: fmt(req.limitPx),
            s: fmt(req.sz),
            r: false,
            t: { limit: { tif: req.tif } },
          },
        ],
        grouping: 'na',
        builder: { b, f },
      });
      const st = res.response.data.statuses[0] as {
        filled?: { totalSz: string; avgPx: string; oid: number };
        resting?: { oid: number };
      };
      if (st.resting) {
        return {
          simulated: false,
          status: 'resting',
          oid: st.resting.oid,
          filledSz: 0,
          avgPx: 0,
          notionalUsd: 0,
          builderFeeUsd: 0,
        };
      }
      const filledSz = Number(st.filled?.totalSz ?? 0);
      const avgPx = Number(st.filled?.avgPx ?? 0);
      const oid = st.filled?.oid;
      const fills = oid ? (await userFills(this.master)).filter((x) => x.oid === oid) : [];
      return {
        simulated: false,
        status: statusOf(filledSz, req.sz),
        oid,
        filledSz,
        avgPx,
        notionalUsd: filledSz * avgPx,
        builderFeeUsd: fills.reduce((s, x) => s + Number(x.builderFee ?? 0), 0),
        fillHashes: fills.map((x) => x.hash),
      };
    } catch (err) {
      return rejected(false, (err as Error).message);
    }
  }

  async cancel(req: { outcome: number; side: OutcomeSide; oid?: number | undefined }) {
    if (req.oid === undefined) throw new Error('live cancel needs an oid');
    await this.agent.cancel({
      cancels: [{ a: outcomeAssetId(req.outcome, req.side), o: req.oid }],
    });
    const s = await orderStatus(this.master, req.oid);
    return { ok: s.order?.status === 'canceled' };
  }
}

/** HL_EXECUTION=live opts in once the float holds testnet USDC; default is the approved paper mode. */
export function createExecutor(): Executor {
  return process.env.HL_EXECUTION === 'live' ? new LiveExecutor() : new PaperExecutor();
}
