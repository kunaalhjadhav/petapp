'use client';

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/lib/api';
import { Button, ErrorNote, buttonClass } from './ui';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Submits through the action without React's automatic form reset, so a failed submit keeps
 * what the person typed. Forms are reset explicitly on success where that makes sense.
 */
export function keepValues(run: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => run(fd));
  };
}

/** Pending state of the surrounding form, provided by the form components below. */
export const PendingContext = createContext(false);

export function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
}: {
  children: ReactNode;
  variant?: 'primary' | 'danger' | 'secondary';
  size?: 'md' | 'sm';
}) {
  const status = useFormStatus();
  const pending = useContext(PendingContext) || status.pending;
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending}>
      {pending ? 'Saving…' : children}
    </Button>
  );
}

/** Short confirmation shown after a successful action, announced to screen readers. */
function useFlash(state: ActionState) {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!state?.ok) return;
    setFlash(state.message);
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [state]);
  return flash;
}

/**
 * A button that opens a modal form. The dialog closes on success; errors stay inside it.
 * `children` are the form fields.
 */
export function ActionDialog({
  label,
  title,
  description,
  action,
  submitLabel,
  variant = 'secondary',
  danger = false,
  size = 'md',
  children,
}: {
  label: string;
  title: string;
  description?: ReactNode;
  action: Action;
  submitLabel: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  danger?: boolean;
  size?: 'md' | 'sm';
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, null);
  const flash = useFlash(state);

  useEffect(() => {
    if (state?.ok) {
      ref.current?.close();
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <>
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          className={buttonClass(variant, size)}
          onClick={() => ref.current?.showModal()}
        >
          {label}
        </button>
        <span role="status" aria-live="polite" className="text-sm text-good">
          {flash}
        </span>
      </span>
      <dialog
        ref={ref}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-0 text-ink shadow-xl"
      >
        <PendingContext.Provider value={pending}>
          <form ref={formRef} onSubmit={keepValues(formAction)} className="flex flex-col gap-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              {description && <div className="mt-1 text-sm text-muted">{description}</div>}
            </div>
            {children}
            {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => ref.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton variant={danger ? 'danger' : 'primary'}>{submitLabel}</SubmitButton>
            </div>
          </form>
        </PendingContext.Provider>
      </dialog>
    </>
  );
}

/** An inline form (no dialog) that shows its own success or error message. */
export function InlineForm({
  action,
  children,
  className = '',
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const flash = useFlash(state);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <PendingContext.Provider value={pending}>
      <form ref={formRef} onSubmit={keepValues(formAction)} className={className}>
        {children}
        <span role="status" aria-live="polite" className="text-sm">
          {state && !state.ok ? (
            <span className="text-danger">{state.message}</span>
          ) : flash ? (
            <span className="text-good">{flash}</span>
          ) : null}
        </span>
      </form>
    </PendingContext.Provider>
  );
}

/** A switch that submits immediately when toggled. */
export function ToggleForm({
  action,
  checked,
  label,
  name = 'enabled',
}: {
  action: Action;
  checked: boolean;
  label: string;
  name?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [on, setOn] = useState(checked);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => setOn(checked), [checked]);
  useEffect(() => {
    if (state && !state.ok) setOn(checked);
  }, [state, checked]);
  return (
    <form ref={formRef} action={formAction} className="inline-flex items-center gap-3">
      <input type="hidden" name={name} value={on ? 'true' : 'false'} />
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => {
          setOn(!on);
          queueMicrotask(() => formRef.current?.requestSubmit());
        }}
        className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-teal' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[22px]' : 'left-0.5'}`}
        />
      </button>
      {state && !state.ok && <span className="text-sm text-danger">{state.message}</span>}
    </form>
  );
}
