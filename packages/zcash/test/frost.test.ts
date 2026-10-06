// PRD 7.5 — FROST (RedPallas) 2-of-3 against the three live signer containers (infra/frost),
// coordinated by the tyr sidecar. Any 2 signers produce a group signature the sidecar verifies;
// a single signer cannot; a signer never signs the same receipt twice.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PayoutInstruction } from '../src/sidecar.js';
import { ev, tyr, user } from './helpers.js';

const ix = async (): Promise<PayoutInstruction> => ({
  v: 1,
  receipt_id: `frost-test-${randomUUID()}`,
  to: await user.address(),
  zat: 10_000,
  memo: 'frost test',
});

describe('FROST 2-of-3', () => {
  it.each([[[1, 2]], [[1, 3]], [[2, 3]]])(
    'signers %j produce a valid group signature',
    async (ids) => {
      const r = await tyr.frostSign(await ix(), ids);
      expect(r.signature).toMatch(/^[0-9a-f]{128}$/);
      expect(r.signers).toEqual(ids);
      ev(`frost ${ids.join('+')}`, r.signature);
    },
  );

  it.each([[[1]], [[2]], [[3]]])('signer %j alone fails', async (ids) => {
    await expect(tyr.frostSign(await ix(), ids)).rejects.toThrow(/commitments/i);
  });

  it('refuses to sign a receipt twice', async () => {
    const i = await ix();
    await tyr.frostSign(i, [1, 2]);
    await expect(tyr.frostSign(i, [1, 3])).rejects.toThrow(/already signed/);
  });

  it('enforces the payout policy (amount cap, UA recipient)', async () => {
    await expect(tyr.frostSign({ ...(await ix()), zat: 1e12 }, [1, 2])).rejects.toThrow(/outside/);
    await expect(
      tyr.frostSign({ ...(await ix()), to: 'tmFEiV49cx5aZE7yi4viW4d5nBRVja9CmE6' }, [1, 2]),
    ).rejects.toThrow(/unified address/);
  });

  it('the user-role wallet cannot use /payout and tyr cannot use /send', async () => {
    await expect(user.payout(await ix())).rejects.toThrow(/403/);
    await expect(tyr.send('zcash:uregtest1abc?amount=1')).rejects.toThrow(/403/);
  });
});
