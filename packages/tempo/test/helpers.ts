import { createServer, type Server } from 'node:http';
import { PrismaClient } from '@tyr/db';
import { Abis } from 'viem/tempo';
import type { Address } from 'viem';
import { ALPHA_USD, publicClient, relyingParty, treasuryClient } from '../src/index.js';
import { SoftAuthenticator } from './softAuthenticator.js';
import { registrationOptions, verifyRegistration } from '../src/index.js';

export const db = new PrismaClient();

export const balanceOf = (who: Address) =>
  publicClient().readContract({
    address: ALPHA_USD,
    abi: Abis.tip20,
    functionName: 'balanceOf',
    args: [who],
  });

/** Full WebAuthn registration through the real server-side verifier. */
export async function registerUser() {
  const rp = relyingParty();
  const auth = new SoftAuthenticator(rp.rpId, rp.origin);
  const opts = await registrationOptions(db, rp);
  const user = await verifyRegistration(db, auth.create(opts.challenge) as never, rp);
  return { auth, user };
}

export async function fund(to: Address, amount: bigint) {
  const c = treasuryClient();
  const hash = await c.writeContract({
    address: ALPHA_USD,
    abi: Abis.tip20,
    functionName: 'transfer',
    args: [to, amount],
  } as never);
  const r = await c.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`fund failed ${hash}`);
  return hash;
}

/** Serve a fetch handler (e.g. the sponsor relay) over real HTTP on a random port. */
export async function serve(
  handler: (req: Request) => Promise<Response>,
): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const init: RequestInit = {
      method: req.method ?? 'GET',
      headers: req.headers as Record<string, string>,
    };
    if (req.method === 'POST') init.body = Buffer.concat(chunks);
    const r = await handler(new Request(`http://localhost${req.url}`, init));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, server };
}
