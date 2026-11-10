import type { Metadata } from 'next';
import Link from 'next/link';
import { Mark } from '@/components/brand';
import { ForgotForm } from './forms';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Mark size={36} />
          <p className="font-semibold">PetApp Admin</p>
        </div>
        <h1 className="mb-1 text-title font-semibold">Forgot your password?</h1>
        <p className="mb-6 text-sm text-muted">
          Enter your work email. If it belongs to a staff account, we’ll email you a link to set a
          new password.
        </p>
        <ForgotForm />
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-teal hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
