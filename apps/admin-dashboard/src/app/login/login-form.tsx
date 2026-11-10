'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ErrorNote, Field, Input } from '@/components/ui';
import { PendingContext, SubmitButton, keepValues } from '@/components/forms';
import { login, type LoginState } from './actions';

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);
  const ticket = state?.mfaTicket;
  return (
    <PendingContext.Provider value={pending}>
      {ticket ? (
        // Step 2: two-factor sign-in.
        <form key="code" onSubmit={keepValues(action)} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? '/'} />
          <input type="hidden" name="mfaTicket" value={ticket} />
          <p className="text-sm text-muted">
            Open your authenticator app and enter the 6-digit code for PetApp Admin. Lost your
            phone? Enter one of your recovery codes instead.
          </p>
          <Field label="Code" htmlFor="code">
            <Input
              id="code"
              name="code"
              autoComplete="one-time-code"
              inputMode="text"
              required
              autoFocus
              maxLength={20}
            />
          </Field>
          {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
          <SubmitButton>Verify</SubmitButton>
          <Link href="/login" className="text-center text-sm text-teal hover:underline">
            Start again
          </Link>
        </form>
      ) : (
        <form key="password" onSubmit={keepValues(action)} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? '/'} />
          {notice && !state && (
            <p className="rounded-md bg-warn-wash px-3 py-2 text-sm text-warn">{notice}</p>
          )}
          <Field label="Work email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
          <SubmitButton>Sign in</SubmitButton>
          <Link href="/forgot-password" className="text-center text-sm text-teal hover:underline">
            Forgot your password?
          </Link>
        </form>
      )}
    </PendingContext.Provider>
  );
}
