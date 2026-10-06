"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signIn, signUp } from "../../_app/passkey";
import { ErrorNote } from "../../_app/ui";

function Start() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const qc = useQueryClient();
  const done = async (to: string) => {
    await qc.invalidateQueries();
    router.replace(to);
  };
  const create = useMutation({ mutationFn: signUp, onSuccess: () => done("/onboarding/limit") });
  const login = useMutation({ mutationFn: signIn, onSuccess: () => done(next ?? "/markets") });
  const busy = create.isPending || login.isPending;

  return (
    <div className="mx-auto max-w-md pt-10 text-center">
      <p className="eyebrow text-olive">Welcome to tyr</p>
      <h1 className="mt-3 font-serif text-5xl leading-tight">Continue with your fingerprint</h1>
      <p className="mt-4 text-ink-soft">
        Your passkey is your account on Tempo. No email, no seed phrase, no gas.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => create.mutate()}>
          {create.isPending ? "Waiting for passkey…" : "Create account with passkey"}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => login.mutate()}>
          {login.isPending ? "Waiting for passkey…" : "I already have a passkey"}
        </button>
      </div>
      <ErrorNote error={create.error ?? login.error} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Start />
    </Suspense>
  );
}
