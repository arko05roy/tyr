// HTTP client for services/zcash-sidecar (tyr wallet on :7200, test user wallet on :7201).
export type Incoming = {
  txid: string;
  value: number;
  height: number;
  confirmed: boolean;
  memos: string[];
};
export type OutgoingView = {
  txid: string;
  outputs: {
    recipient: string | null;
    value: number;
    memos: string[];
    confirmed: boolean;
    height: number;
    fee: number | null;
  }[];
};
export type PayoutInstruction = { v: 1; receipt_id: string; to: string; zat: number; memo: string };

export class SidecarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const tyrSidecarUrl = () => process.env.ZCASH_SIDECAR_URL ?? 'http://127.0.0.1:7200';

export function sidecar(base = tyrSidecarUrl()) {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await r.text();
    if (!r.ok) throw new SidecarError(`sidecar ${path} ${r.status}: ${text}`, r.status);
    return JSON.parse(text) as T;
  };
  return {
    address: async () => (await call<{ address: string }>('/address')).address,
    sync: () => call<{ height: number }>('/sync', {}),
    incoming: async () => (await call<{ transfers: Incoming[] }>('/incoming')).transfers,
    /** user-role wallet only: pay a ZIP-321 URI */
    send: (uri: string) => call<{ txids: string[] }>('/send', { uri }),
    frostSign: (instruction: PayoutInstruction, signers?: number[]) =>
      call<{ signature: string; signers: number[] }>('/frost/sign', { instruction, signers }),
    outgoing: (txid: string) => call<OutgoingView>(`/outgoing?txid=${encodeURIComponent(txid)}`),
    frostGroup: () =>
      call<{ min_signers: number; max_signers: number; verifying_key: string }>('/frost/group'),
    frostVerify: (instruction: PayoutInstruction, signature: string) =>
      call<{ valid: boolean; verifying_key: string }>('/frost/verify', { instruction, signature }),
    payout: (instruction: PayoutInstruction, signers?: number[]) =>
      call<{ txids: string[]; signature: string; signers: number[] }>('/payout', {
        instruction,
        signers,
      }),
  };
}
