// Generates testnet wallets into .env for any key var that is still blank. Prints public addresses only.
import { readFileSync, writeFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const KEYS = [
  'TEMPO_SPONSOR_PRIVATE_KEY',
  'HL_MASTER_PRIVATE_KEY',
  'HL_AGENT_PRIVATE_KEY',
  'HL_BUILDER_PRIVATE_KEY',
  'ROBINHOOD_HOT_WALLET_KEY',
];
let env = readFileSync('.env', 'utf8');
for (const k of KEYS) {
  const m = new RegExp(`^${k}=(.*)$`, 'm').exec(env);
  let pk = m?.[1]?.trim();
  if (!pk) {
    pk = generatePrivateKey();
    env = m ? env.replace(m[0], `${k}=${pk}`) : `${env.trimEnd()}\n${k}=${pk}\n`;
  }
  console.log(`${k.padEnd(28)} ${privateKeyToAccount(pk as `0x${string}`).address}`);
}
writeFileSync('.env', env);
