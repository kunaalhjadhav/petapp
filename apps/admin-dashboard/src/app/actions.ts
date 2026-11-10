'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

export async function signOut(): Promise<void> {
  try {
    await api('/admin/auth/logout', { method: 'POST' });
  } catch {
    // Signing out locally still matters if the API call fails.
  }
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  redirect('/login?out=1');
}
