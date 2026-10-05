import { checkZcash } from './packages/core/src/guard.ts';
for (const e of [
  'testnet.zec.rocks:443',
  'lightwalletd.testnet.electriccoin.co:9067',
  'zcash.mysideoftheweb.com:19067',
])
  console.log(e, await checkZcash(e));
