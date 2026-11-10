import type { Metadata } from 'next';
import { getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { Field, Input, PageHeader, Panel } from '@/components/ui';
import { InlineForm, SubmitButton } from '@/components/forms';
import { PasswordFields } from '../../forgot-password/forms';
import { changePassword } from './actions';
import { MfaPanel } from './mfa-panel';

export const metadata: Metadata = { title: 'Your account' };
export const dynamic = 'force-dynamic';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ mfa?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  return (
    <>
      <PageHeader
        title="Your account"
        description={`${me.name ?? 'Staff member'} · ${me.email ?? ''}`}
      />
      <Panel>
        <div className="max-w-md p-5">
          <h2 className="font-medium">Password</h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            {me.passwordChangedAt
              ? `Last changed ${formatDateTime(me.passwordChangedAt)}.`
              : 'You’re still using the password you were given. Change it now.'}{' '}
            Changing it signs you out everywhere else.
          </p>
          <InlineForm action={changePassword} resetOnSuccess className="flex flex-col gap-4">
            <Field label="Current password" htmlFor="currentPassword">
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <PasswordFields />
            <div>
              <SubmitButton>Change password</SubmitButton>
            </div>
          </InlineForm>
        </div>
      </Panel>
      <div className="mt-6">
        <Panel>
          <div className="p-5" id="two-factor">
            <h2 className="mb-2 font-medium">Two-factor sign-in</h2>
            {sp.mfa === 'required' && me.mfaSetupRequired && (
              <p
                role="status"
                className="mb-3 rounded-md border border-warn bg-warn-wash px-3 py-2 text-sm text-warn"
              >
                Set up two-factor sign-in to use the dashboard.
              </p>
            )}
            <MfaPanel
              enabled={!!me.mfaEnabled}
              required={!!me.mfaRequired}
              codesLeft={me.recoveryCodesLeft ?? 0}
              since={me.mfaEnabledAt ?? null}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}
