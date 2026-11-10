'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ErrorNote, Field, Input, buttonClass } from '@/components/ui';
import { PendingContext, SubmitButton, keepValues } from '@/components/forms';
import { requestReset, resetPassword } from './actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestReset, null);
  if (state?.ok)
    return (
      <p role="status" className="rounded-md bg-good-wash px-3 py-2 text-sm text-good">
        {state.message}
      </p>
    );
  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-4">
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
        <SubmitButton>Email me a link</SubmitButton>
      </form>
    </PendingContext.Provider>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, null);
  if (state?.ok)
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md bg-good-wash px-3 py-2 text-sm text-good">
          {state.message}
        </p>
        <Link href="/login" className={buttonClass('primary')}>
          Sign in
        </Link>
      </div>
    );
  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <PasswordFields />
        {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
        <SubmitButton>Set password</SubmitButton>
      </form>
    </PendingContext.Provider>
  );
}

/** New password twice, with the rules in words. */
export function PasswordFields() {
  return (
    <>
      <Field
        label="New password"
        htmlFor="newPassword"
        hint="At least 12 characters. A phrase of four or five words works well. Not your name or email, and not a common password."
      >
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </Field>
      <Field label="New password again" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </Field>
    </>
  );
}
