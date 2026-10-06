// PRD 9.2 market → hedge mapping. Stop 9: rule-based over HL outcome templates (featured markets
// rotate, so fixed IDs would go stale); table approved in docs/human-values.md. Only single-stock
// tokens exist on RH testnet (no index ETF), so macro markets use AMZN as the large-cap proxy.
//
// A hedge pays when the bet loses. `yesDirection` is the stock trade that offsets a YES bet; a NO
// bet takes the opposite trade. Markets no rule matches get no hedge.
import { parseTemplate } from '@tyr/hyperliquid';
import { isStock, type StockSymbol } from './chain.js';

export type Direction = 'buy' | 'sell';
export type HedgeRule = { stock: StockSymbol; yesDirection: Direction; rule: string };

const MACRO_PROXY: StockSymbol = 'AMZN';

export function hedgeRule(o: { name: string; description: string }): HedgeRule | null {
  const t = parseTemplate(o.description);
  const name = o.name.replace(/^template:/, '');

  // binaryPrice on a stock perp: YES = price finishes at/above threshold → offset by selling it.
  // Index markets (US500 / S&P) have no ETF token on RH testnet → large-cap proxy, same direction.
  if (/^binaryPrice\d*$/.test(name)) {
    if (/US500|S&P|SPX/i.test(t?.priceDescription ?? ''))
      return { stock: MACRO_PROXY, yesDirection: 'sell', rule: 'US500 index' };
    const perp = t?.perp?.match(/^xyz:([A-Z]+)$/)?.[1];
    if (perp && isStock(perp))
      return { stock: perp, yesDirection: 'sell', rule: `binaryPrice ${perp}` };
  }

  // Fed: a hike is risk-off, so a YES-hike bet is offset by buying; a YES-cut bet by selling.
  if (/^policyRateIncrease/.test(name) || /increase/i.test(t?.bucketLabel ?? ''))
    return { stock: MACRO_PROXY, yesDirection: 'buy', rule: 'fed hike' };
  if (/^policyRateDecrease/.test(name) || /decrease/i.test(t?.bucketLabel ?? ''))
    return { stock: MACRO_PROXY, yesDirection: 'sell', rule: 'fed cut' };

  // CPI print: hot inflation is risk-off (offset by buying), cool is risk-on (offset by selling).
  if (/\bCPI\b/.test(o.description)) {
    if (/^Above/i.test(o.name))
      return { stock: MACRO_PROXY, yesDirection: 'buy', rule: 'CPI above' };
    if (/^Below/i.test(o.name))
      return { stock: MACRO_PROXY, yesDirection: 'sell', rule: 'CPI below' };
  }

  // US government stake in Nvidia: chip-sector positive → offset with AMD.
  if (/Nvidia/i.test(t?.competition ?? ''))
    return { stock: 'AMD', yesDirection: 'sell', rule: 'semis (Nvidia stake)' };

  return null;
}

export const hedgeDirection = (r: HedgeRule, side: 'yes' | 'no'): Direction =>
  side === 'yes' ? r.yesDirection : r.yesDirection === 'buy' ? 'sell' : 'buy';
