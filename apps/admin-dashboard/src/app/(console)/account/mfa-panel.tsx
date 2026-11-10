'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { disableMfa, enableMfa, newRecoveryCodes, startMfa, type MfaResult } from './mfa-actions';

type Props = { enabled: boolean; required: boolean; codesLeft: number; since: string | null };

/** Two-factor sign-in on Your account: set up (password, scan, code, recovery codes), new codes, or turn off. */
export function MfaPanel({ enabled, required, codesLeft, since }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'setup' | 'regenerate' | 'disable'>('idle');

  const run = (fn: () => Promise<MfaResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      if (r.step === 'scan') setScan({ secret: r.secret, qrSvg: r.qrSvg });
      if (r.step === 'codes') {
        setCodes(r.recoveryCodes);
        setScan(null);
        setMode('idle');
      }
      if (r.step === 'off') {
        setMode('idle');
        router.refresh();
      }
    });
  const value = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? '');

  if (codes)
    return (
      <div className="space-y-3" data-testid="recovery-codes">
        <p className="text-sm font-medium">
          Save your recovery codes now. They won’t be shown again.
        </p>
        <p className="text-sm text-muted">
          Each one signs you in once if you lose your phone. Keep them in your password manager, not
          with your phone.
        </p>
        <ul className="grid grid-cols-2 gap-1 rounded-md border border-line bg-paper p-3 font-mono text-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button
          onClick={() => {
            setCodes(null);
            router.refresh();
          }}
        >
          I’ve saved them
        </Button>
      </div>
    );

  if (!enabled)
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {required
            ? 'PetApp requires two-factor sign-in for staff. Set it up to continue.'
            : 'Off. With it on, signing in needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …) as well as your password.'}
        </p>
        {!scan && mode !== 'setup' && (
          <Button variant="primary" onClick={() => setMode('setup')}>
            Set up two-factor sign-in
          </Button>
        )}
        {!scan && mode === 'setup' && (
          <form
            className="flex max-w-md flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              run(() => startMfa(value(f, 'password')));
            }}
          >
            <Field label="Your password" htmlFor="mfa-password">
              <Input
                id="mfa-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <div>
              <Button type="submit" variant="primary" disabled={pending}>
                Continue
              </Button>
            </div>
          </form>
        )}
        {scan && (
          <form
            className="flex max-w-md flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              run(() => enableMfa(value(f, 'code')));
            }}
          >
            <p className="text-sm">1. Scan this with your authenticator app:</p>
            <div
              className="w-44 rounded-md border border-line bg-white p-2"
              role="img"
              aria-label="QR code for your authenticator app"
              dangerouslySetInnerHTML={{ __html: scan.qrSvg }}
            />
            <p className="text-sm text-muted">
              Can’t scan? Enter this key:{' '}
              <code className="break-all font-mono text-ink" data-testid="mfa-secret">
                {scan.secret}
              </code>
            </p>
            <Field label="2. Enter the 6-digit code it shows" htmlFor="mfa-code">
              <Input
                id="mfa-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={7}
              />
            </Field>
            <div>
              <Button type="submit" variant="primary" disabled={pending}>
                Turn on
              </Button>
            </div>
          </form>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        On
        {since
          ? ` since ${new Date(since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : ''}
        . {codesLeft} recovery code{codesLeft === 1 ? '' : 's'} left.
      </p>
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode('regenerate')}>New recovery codes</Button>
          {!required && (
            <Button variant="danger" onClick={() => setMode('disable')}>
              Turn off
            </Button>
          )}
        </div>
      )}
      {mode === 'regenerate' && (
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            run(() => newRecoveryCodes(value(f, 'code')));
          }}
        >
          <Field label="Code from your authenticator app" htmlFor="regen-code">
            <Input
              id="regen-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={7}
            />
          </Field>
          <p className="text-xs text-muted">Your old recovery codes stop working.</p>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              Make new codes
            </Button>
            <Button type="button" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {mode === 'disable' && (
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            run(() => disableMfa(value(f, 'password'), value(f, 'code')));
          }}
        >
          <Field label="Your password" htmlFor="off-password">
            <Input
              id="off-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Code from your authenticator app" htmlFor="off-code">
            <Input id="off-code" name="code" autoComplete="one-time-code" required maxLength={20} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={pending}>
              Turn off
            </Button>
            <Button type="button" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
