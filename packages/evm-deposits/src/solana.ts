// PRD 6.3 — Solana devnet direct deposit: the user sends Circle devnet USDC (e.g. from Phantom) to
// their deposit owner address; it lands in that owner's classic-SPL USDC ATA. The watcher reads
// finalized signatures on each ATA and credits the token-balance delta of every new transfer.
import type { Address, Signature } from '@solana/kit';
import type { PrismaClient } from '@tyr/db';
import { solana } from '@tyr/solana';
import { SOLANA_DEVNET_USDC, usdcAta } from './addresses.js';
import { getCursor, recordDeposit, setCursor } from './ledger.js';

type TokenBalance = { accountIndex: number; mint: string; uiTokenAmount: { amount: string } };
type ParsedTx = {
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction: { message: { accountKeys: { pubkey: string }[] } };
};

/** USDC base units the ATA gained in this tx (0 if none / failed). */
async function usdcReceived(sig: Signature, ata: Address): Promise<bigint> {
  const tx = (await solana()
    .rpc.getTransaction(sig, {
      encoding: 'jsonParsed',
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })
    .send()) as unknown as ParsedTx | null;
  if (!tx?.meta || tx.meta.err) return 0n;
  const idx = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey === ata);
  if (idx < 0) return 0n;
  const amt = (list?: TokenBalance[]) =>
    BigInt(
      list?.find((b) => b.accountIndex === idx && b.mint === SOLANA_DEVNET_USDC)?.uiTokenAmount
        .amount ?? 0,
    );
  const delta = amt(tx.meta.postTokenBalances) - amt(tx.meta.preTokenBalances);
  return delta > 0n ? delta : 0n;
}

export async function scanSolanaUsdc(db: PrismaClient): Promise<string[]> {
  const rows = await db.depositAddress.findMany({ where: { chain: 'solana' } });
  const ids: string[] = [];
  for (const row of rows) {
    const ata = await usdcAta(row.address as Address);
    const cursorKey = `solana:usdc:${ata}`;
    const until = (await getCursor(db, cursorKey)) as Signature | null;
    const sigs = await solana()
      .rpc.getSignaturesForAddress(ata, {
        commitment: 'finalized',
        limit: 100,
        ...(until ? { until } : {}),
      })
      .send();
    const newest = sigs[0];
    if (!newest) continue;
    for (const s of [...sigs].reverse()) {
      if (s.err) continue;
      const received = await usdcReceived(s.signature, ata);
      const d = await recordDeposit(db, {
        userId: row.userId,
        sourceChain: 'solanaDevnet',
        sourceTx: s.signature,
        asset: 'USDC',
        rawAmount: received,
        usdMicro: received, // Circle USDC and tyrUSD are both 6 decimals
      });
      if (d) ids.push(d.id);
    }
    await setCursor(db, cursorKey, newest.signature);
  }
  return ids;
}
