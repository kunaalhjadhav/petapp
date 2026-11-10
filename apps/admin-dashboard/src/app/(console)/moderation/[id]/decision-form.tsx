'use client';

import { useActionState } from 'react';
import type { Resolution } from '@/lib/types';
import { ErrorNote, inputClass } from '@/components/ui';
import { PendingContext, SubmitButton, keepValues } from '@/components/forms';
import { resolveCase } from '../actions';

export function DecisionForm({
  caseId,
  options,
}: {
  caseId: string;
  options: Array<{ value: Resolution; label: string; hint: string }>;
}) {
  const [state, action, pending] = useActionState(resolveCase.bind(null, caseId), null);
  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={keepValues(action)} className="flex flex-col gap-4 px-4 py-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Outcome</legend>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex items-start gap-3 rounded-md border border-line-soft px-3 py-2 hover:border-line has-[:checked]:border-teal has-[:checked]:bg-teal-wash"
            >
              <input
                type="radio"
                name="resolution"
                value={o.value}
                required
                className="mt-1 accent-[var(--color-teal)]"
              />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className="text-sm font-medium">
            Note
          </label>
          <textarea
            id="note"
            name="note"
            required
            minLength={3}
            maxLength={1000}
            rows={3}
            className={`${inputClass} h-auto py-2`}
            placeholder="Which rule, and anything the next moderator should know"
          />
          <p className="text-xs text-muted">The owner is told the outcome, not your note.</p>
        </div>
        {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
        {state?.ok && <p className="text-sm text-good">{state.message}</p>}
        <div>
          <SubmitButton>Resolve case</SubmitButton>
        </div>
      </form>
    </PendingContext.Provider>
  );
}
