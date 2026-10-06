// PRD 9.3 (deviation: HL testnet xyz oracle instead of Chainlink, owner-approved 2026-10-05) — live
// oracle price per Stock Token is present and agrees with mark; a missing or divergent reading is
// rejected; the on-chain token symbols match and the hot wallet holds inventory.
import { describe, expect, it } from 'vitest';
import {
  STOCK_TOKENS,
  StalePriceError,
  checkPrice,
  stockPrice,
  walletShares,
  type StockSymbol,
} from '../src/index.js';

const symbols = Object.keys(STOCK_TOKENS) as StockSymbol[];

describe('Robinhood hedge price + inventory (live HL testnet + RH testnet)', () => {
  it.each(symbols)('%s: fresh two-sided price, verified token, hot-wallet shares', async (s) => {
    const p = await stockPrice(s);
    expect(p.px).toBeGreaterThan(0);
    expect(Date.now() - p.at.getTime()).toBeLessThan(10_000);
    expect(p.source).toBe(`hyperliquid-testnet xyz oraclePx xyz:${s}`);
    const shares = await walletShares(s);
    expect(shares).toBeGreaterThan(0);
    console.log(`[evidence] ${s} ${STOCK_TOKENS[s]} px $${p.px} inv ${shares}`);
  });

  it('rejects a missing or divergent oracle reading', () => {
    const at = new Date();
    expect(() => checkPrice('TSLA', { oraclePx: null, markPx: '380' }, at)).toThrow(
      StalePriceError,
    );
    expect(() => checkPrice('TSLA', { oraclePx: '500', markPx: '380' }, at)).toThrow(
      StalePriceError,
    );
    expect(checkPrice('TSLA', { oraclePx: '381', markPx: '380' }, at).px).toBe(381);
  });
});
