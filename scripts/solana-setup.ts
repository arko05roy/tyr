/**
 * Phase 3 one-time devnet setup (idempotent):
 *  1. create tyrUSD (Token-2022, 6 dp, ConfidentialTransferMint, auditor = compliance key)
 *  2. init tyr_settlement Config (admin = deployer, relayer = treasury)
 *  3. create + configure the tyr escrow confidential account
 * Run: pnpm tsx scripts/solana-setup.ts
 */
import 'dotenv/config';
import {
  assertDevnet,
  auditorKeys,
  createConfidentialAccount,
  createTyrUsdMint,
  elgamalAddress,
  escrowKeys,
  explorer,
  fetchConfig,
  initConfigIx,
  sendInstructions,
  signerFromFile,
  treasury,
} from '@tyr/solana';

await assertDevnet();
const t = await treasury();
const admin = await signerFromFile(
  process.env.SOLANA_DEPLOYER_KEYPAIR ?? 'keys/solana-deployer.json',
);

if (!process.env.SOLANA_TYRUSD_MINT) {
  const { mint, sigs } = await createTyrUsdMint(auditorKeys());
  console.log(`tyrUSD mint ${mint}\n  auditor ElGamal ${elgamalAddress(auditorKeys())}`);
  sigs.forEach((s) => console.log('  ' + explorer(s)));
  console.log(`→ add SOLANA_TYRUSD_MINT=${mint} to .env and re-run`);
  process.exit(0);
}

if (!(await fetchConfig())) {
  const sig = await sendInstructions([await initConfigIx(admin, t.address)], admin);
  console.log(`config init (admin ${admin.address}, relayer ${t.address}) ${explorer(sig)}`);
}
console.log('config', await fetchConfig());

const esc = await escrowKeys();
const { token, sigs } = await createConfidentialAccount(esc);
console.log(`escrow owner ${esc.owner.address} token ${token}`);
sigs.forEach((s) => console.log('  ' + explorer(s)));
