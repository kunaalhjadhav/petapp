import type { Metadata } from 'next';
import { Mark } from '@/components/brand';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string; out?: string }>;
}) {
  const sp = await searchParams;
  const notice = sp.expired
    ? 'Your session ended. Sign in again to continue.'
    : sp.out
      ? 'You’ve signed out.'
      : undefined;
  const env = process.env.NEXT_PUBLIC_ENV_LABEL;
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Mark size={36} />
          <div>
            <p className="font-semibold">PetApp Admin</p>
            {env && <p className="text-sm text-muted">{env}</p>}
          </div>
        </div>
        <h1 className="mb-1 text-title font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-muted">
          For PetApp staff. Every change you make is recorded.
        </p>
        <LoginForm next={sp.next} notice={notice} />
      </div>
    </main>
  );
}
