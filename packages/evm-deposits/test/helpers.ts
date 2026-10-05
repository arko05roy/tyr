import { PrismaClient } from '@tyr/db';
import { availableBalance, confidentialAccount } from '@tyr/pipeline';
import { erc20Abi, formatUnits, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { registerUser } from '../../tempo/test/helpers.js';
import { creditPending, evmClient, type EvmSource } from '../src/index.js';

export const db = new PrismaClient();
export const ev = (label: string, url: string) => console.log(`[evidence] ${label}: ${url}`);

/** Real passkey user (WebAuthn registration through the server verifier). */
export async function newUser() {
  return (await registerUser()).user;
}

export const sender = () => privateKeyToAccount(process.env.EVM_TEST_SENDER_KEY as Hex);

export async function bankroll(userId: string): Promise<bigint> {
  return availableBalance(await confidentialAccount(db, userId));
}

/** Fail with a faucet pointer instead of a confusing revert when the test wallet is empty. */
export async function requireFunds(src: EvmSource, needUsdc: bigint, needEth: bigint) {
  const who: Address = sender().address;
  const c = evmClient(src);
  const eth = await c.getBalance({ address: who });
  const usdc = src.usdc
    ? await c.readContract({
        address: src.usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [who],
      })
    : 0n;
  if (eth < needEth || usdc < needUsdc)
    throw new Error(
      `test sender ${who} on ${src.key} has ${formatUnits(eth, 18)} ETH / ${formatUnits(usdc, 6)} USDC; ` +
        `needs ${formatUnits(needEth, 18)} ETH + ${formatUnits(needUsdc, 6)} USDC (faucet.circle.com + a ${src.key} ETH faucet)`,
    );
}

/** Run `scan` then credit until the deposit for `sourceTx` is credited. */
export async function untilCredited(
  scan: () => Promise<unknown>,
  sourceTx: string,
  timeoutMs = 300_000,
) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    await scan();
    await creditPending(db);
    const d = await db.deposit.findFirst({ where: { sourceTx } });
    if (d?.status === 'credited') return d;
    if (Date.now() > end) throw new Error(`deposit ${sourceTx} not credited (status ${d?.status})`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
