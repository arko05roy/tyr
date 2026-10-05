import { createHash, randomBytes } from 'node:crypto';
import {
  AccountRole,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import idl from './idl/tyr_settlement.json' with { type: 'json' };
import { solana } from './client.js';

/** tyr_settlement on devnet (PRD 3.4). Hand-encoded from the Anchor IDL — 6 instructions. */
export const SETTLEMENT_PROGRAM = idl.address as Address;
const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;

const disc = (name: string) => {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`no ix ${name}`);
  return Uint8Array.from(ix.discriminator);
};
const accountDisc = (name: string) => {
  const a = idl.accounts.find((x) => x.name === name);
  if (!a) throw new Error(`no account ${name}`);
  return Uint8Array.from(a.discriminator);
};

const enc = getAddressEncoder();
const u64 = (n: bigint | number) => Uint8Array.from(getU64Encoder().encode(n));
const cat = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));

/** order_id on-chain = sha256(tyr Order.id) — the plaintext id never touches Solana. */
export const orderId32 = (orderId: string) =>
  new Uint8Array(createHash('sha256').update(`tyr/order/${orderId}`).digest());

export const configPda = async () =>
  (await getProgramDerivedAddress({ programAddress: SETTLEMENT_PROGRAM, seeds: ['config'] }))[0];
export const marketPda = async (marketId: bigint) =>
  (
    await getProgramDerivedAddress({
      programAddress: SETTLEMENT_PROGRAM,
      seeds: ['market', u64(marketId)],
    })
  )[0];
export const positionPda = async (user: Address, orderId: Uint8Array) =>
  (
    await getProgramDerivedAddress({
      programAddress: SETTLEMENT_PROGRAM,
      seeds: ['position', enc.encode(user), orderId],
    })
  )[0];

const signerMeta = (s: TransactionSigner, writable = false) => ({
  address: s.address,
  role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
  signer: s,
});
const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const rw = (address: Address) => ({ address, role: AccountRole.WRITABLE });

export async function initConfigIx(
  admin: TransactionSigner,
  relayer: Address,
): Promise<Instruction> {
  return {
    programAddress: SETTLEMENT_PROGRAM,
    accounts: [rw(await configPda()), signerMeta(admin, true), ro(SYSTEM_PROGRAM)],
    data: cat(disc('init_config'), Uint8Array.from(enc.encode(relayer))),
  };
}

export async function setRelayerIx(
  admin: TransactionSigner,
  relayer: Address,
): Promise<Instruction> {
  return {
    programAddress: SETTLEMENT_PROGRAM,
    accounts: [rw(await configPda()), signerMeta(admin)],
    data: cat(disc('set_relayer'), Uint8Array.from(enc.encode(relayer))),
  };
}

export async function pauseIx(admin: TransactionSigner, paused: boolean): Promise<Instruction> {
  return {
    programAddress: SETTLEMENT_PROGRAM,
    accounts: [rw(await configPda()), signerMeta(admin)],
    data: cat(disc('pause'), Uint8Array.of(paused ? 1 : 0)),
  };
}

export async function registerMarketIx(
  admin: TransactionSigner,
  marketId: bigint,
): Promise<Instruction> {
  return {
    programAddress: SETTLEMENT_PROGRAM,
    accounts: [
      ro(await configPda()),
      rw(await marketPda(marketId)),
      signerMeta(admin, true),
      ro(SYSTEM_PROGRAM),
    ],
    data: cat(disc('register_market'), u64(marketId)),
  };
}

export async function openPositionIx(a: {
  relayer: TransactionSigner;
  user: Address;
  marketId: bigint;
  orderId: Uint8Array;
  side: 0 | 1;
  sizeCommitment: Uint8Array;
}): Promise<Instruction> {
  return {
    programAddress: SETTLEMENT_PROGRAM,
    accounts: [
      ro(await configPda()),
      rw(await marketPda(a.marketId)),
      rw(await positionPda(a.user, a.orderId)),
      ro(a.user),
      signerMeta(a.relayer, true),
      ro(SYSTEM_PROGRAM),
    ],
    data: cat(disc('open_position'), a.orderId, Uint8Array.of(a.side), a.sizeCommitment),
  };
}

export async function settlePositionIx(a: {
  relayer: TransactionSigner;
  user: Address;
  marketId: bigint;
  orderId: Uint8Array;
  outcome: number;
  payoutCommitment: Uint8Array;
}): Promise<Instruction> {
  return {
    programAddress: SETTLEMENT_PROGRAM,
    accounts: [
      ro(await configPda()),
      rw(await marketPda(a.marketId)),
      rw(await positionPda(a.user, a.orderId)),
      signerMeta(a.relayer),
    ],
    data: cat(disc('settle_position'), a.orderId, Uint8Array.of(a.outcome), a.payoutCommitment),
  };
}

// ── account readers ─────────────────────────────────────────────────────────

async function raw(address: Address): Promise<Buffer | null> {
  const r = await solana()
    .rpc.getAccountInfo(address, { encoding: 'base64', commitment: 'confirmed' })
    .send();
  return r.value ? Buffer.from(r.value.data[0], 'base64') : null;
}

function checkDisc(b: Buffer, name: string) {
  if (!b.subarray(0, 8).equals(Buffer.from(accountDisc(name)))) throw new Error(`not a ${name}`);
}

const dec = getAddressDecoder();
const addr = (b: Buffer, o: number) => dec.decode(b.subarray(o, o + 32));

export async function fetchConfig() {
  const b = await raw(await configPda());
  if (!b) return null;
  checkDisc(b, 'Config');
  return { admin: addr(b, 8), relayer: addr(b, 40), paused: b[72] === 1 };
}

export async function fetchMarket(marketId: bigint) {
  const b = await raw(await marketPda(marketId));
  if (!b) return null;
  checkDisc(b, 'Market');
  return { marketId: b.readBigUInt64LE(8), openPositions: b.readBigUInt64LE(16) };
}

export async function fetchPosition(user: Address, orderId: Uint8Array) {
  const address = await positionPda(user, orderId);
  const b = await raw(address);
  if (!b) return null;
  checkDisc(b, 'Position');
  // user 8 | market 40 | order_id 72 | side 104 | size_commitment 105 | status 137 | outcome 138
  // | payout_commitment 139 | opened_at 171 | settled_at 179 | bump 187
  return {
    address,
    raw: b,
    user: addr(b, 8),
    market: addr(b, 40),
    orderId: new Uint8Array(b.subarray(72, 104)),
    side: b.readUInt8(104),
    sizeCommitment: new Uint8Array(b.subarray(105, 137)),
    status: b[137] === 0 ? ('open' as const) : ('settled' as const),
    outcome: b.readUInt8(138),
    payoutCommitment: new Uint8Array(b.subarray(139, 171)),
    openedAt: b.readBigInt64LE(171),
    settledAt: b.readBigInt64LE(179),
  };
}

/** Anchor custom error code (6000+) from a failed send, if any. */
export function anchorErrorCode(err: unknown): number | undefined {
  const s = JSON.stringify(err, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + String(err);
  const m = s.match(/"Custom":\s*(\d+)|custom program error: 0x([0-9a-f]+)/i);
  if (!m) return undefined;
  return m[1] ? Number(m[1]) : parseInt(m[2] ?? '', 16);
}

export const TyrError = Object.fromEntries(idl.errors.map((e) => [e.name, e.code])) as Record<
  'Unauthorized' | 'Paused' | 'AlreadySettled' | 'InvalidSide',
  number
>;

/**
 * Hiding commitment to a stake/payout: sha256("tyr/amount/v1" ‖ u64le(amount) ‖ salt32).
 * Only the 32-byte digest goes on-chain; tyr keeps the salt so the amount can later be proven
 * (Phase 10) by revealing (amount, salt). (zk-sdk's PedersenOpening is not serializable from JS.)
 */
export function commitAmount(amount: bigint, salt = randomBytes(32)) {
  return { commitment: amountCommitment(amount, salt), salt: salt.toString('hex') };
}

export function amountCommitment(amount: bigint, salt: Buffer): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update('tyr/amount/v1').update(u64(amount)).update(salt).digest(),
  );
}
