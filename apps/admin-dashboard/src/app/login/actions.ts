'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, api, type ActionState } from '@/lib/api';
import { sessionCookies, type TokenPair } from '@/lib/session';

/** Only same-site relative paths are allowed as a post-login destination (no open redirect). */
function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/login') ? s : '/';
}

export type LoginState = (NonNullable<ActionState> & { mfaTicket?: string }) | null;

export async function login(_: LoginState, fd: FormData): Promise<LoginState> {
  const ticket = String(fd.get('mfaTicket') ?? '');
  // Step 2 (two-factor sign-in): the ticket from step 1, and a code from the authenticator app or a recovery code.
  if (ticket) {
    const code = String(fd.get('code') ?? '').trim();
    if (!code)
      return {
        ok: false,
        message: 'Enter the code from your authenticator app.',
        mfaTicket: ticket,
      };
    let tokens: TokenPair;
    try {
      tokens = (
        await api<{ tokens: TokenPair }>('/admin/auth/login/mfa', {
          method: 'POST',
          body: { mfaTicket: ticket, code },
          anonymous: true,
        })
      ).tokens;
    } catch (e) {
      if (e instanceof ApiError) {
        const expired = /expired|password again/.test(e.message);
        return {
          ok: false,
          message: e.status === 429 ? 'Too many attempts. Wait a minute and try again.' : e.message,
          mfaTicket: expired ? undefined : ticket,
        };
      }
      throw e;
    }
    const jar = await cookies();
    for (const c of sessionCookies(tokens)) jar.set(c.name, c.value, c.options);
    redirect(safeNext(fd.get('next')));
  }
  const email = String(fd.get('email') ?? '').trim();
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { ok: false, message: 'Enter your email and password.' };
  let tokens: TokenPair;
  try {
    const r = await api<{ tokens?: TokenPair; mfaRequired?: boolean; mfaTicket?: string }>(
      '/admin/auth/login',
      {
        method: 'POST',
        body: { email, password },
        anonymous: true,
      },
    );
    if (r.mfaRequired && r.mfaTicket) return { ok: true, message: '', mfaTicket: r.mfaTicket };
    tokens = r.tokens!;
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        message: e.status === 429 ? 'Too many attempts. Wait a minute and try again.' : e.message,
      };
    throw e;
  }
  const jar = await cookies();
  for (const c of sessionCookies(tokens)) jar.set(c.name, c.value, c.options);
  redirect(safeNext(fd.get('next')));
}
