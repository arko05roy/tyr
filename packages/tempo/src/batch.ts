import { encodeFunctionData, type Address, type Hex } from 'viem';
import { Abis } from 'viem/tempo';

export type Call = { to: Address; data: Hex; value?: bigint };

/** TIP-20 transfer / transferWithMemo call for a Tempo batched transaction (PRD 2.3). */
export function transferCall(token: Address, to: Address, amount: bigint, memo?: Hex): Call {
  return {
    to: token,
    data: memo
      ? encodeFunctionData({
          abi: Abis.tip20,
          functionName: 'transferWithMemo',
          args: [to, amount, memo],
        })
      : encodeFunctionData({ abi: Abis.tip20, functionName: 'transfer', args: [to, amount] }),
  };
}

export function approveCall(token: Address, spender: Address, amount: bigint): Call {
  return {
    to: token,
    data: encodeFunctionData({ abi: Abis.tip20, functionName: 'approve', args: [spender, amount] }),
  };
}
