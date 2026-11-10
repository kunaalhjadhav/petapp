import type { Metadata } from 'next';
import Link from 'next/link';
import { Mark } from '@/components/brand';
import { api } from '@/lib/api';
import { ResetForm } from '../forgot-password/forms';

export const metadata: Metadata = { title: 'Set a new password', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

/** The page an emailed reset link opens. The token never leaves this page except to the API. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  const check = token
    ? await api<{ valid: boolean; email: string | null }>('/admin/auth/password/reset', {
        query: { token },
        anonymous: true,
      }).catch(() => ({ valid: false, email: null }))
    : { valid: false, email: null };
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Mark size={36} />
          <p className="font-semibold">PetApp Admin</p>
        </div>
        <h1 className="mb-1 text-title font-semibold">Set a new password</h1>
        {check.valid ? (
          <>
            <p className="mb-6 text-sm text-muted">
              For {check.email}. You’ll be signed out everywhere else.
            </p>
            <ResetForm token={token} />
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-muted">
              This link has expired or was already used. Links work once, for a short time.
            </p>
            <Link href="/forgot-password" className="text-sm text-teal hover:underline">
              Ask for a new link
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
