'use server';

import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';
import { ApiError, api } from '@/lib/api';

export type MfaResult =
  | { ok: false; message: string }
  | { ok: true; step: 'scan'; secret: string; qrSvg: string }
  | { ok: true; step: 'codes'; recoveryCodes: string[] }
  | { ok: true; step: 'off' };

const fail = (e: unknown): MfaResult => {
  if (e instanceof ApiError)
    return {
      ok: false,
      message: e.status === 429 ? 'Too many attempts. Wait a minute and try again.' : e.message,
    };
  throw e;
};

/** Step 1: the password again, then a QR code (and the secret, for typing in) for the authenticator app. */
export async function startMfa(password: string): Promise<MfaResult> {
  try {
    const r = await api<{ secret: string; otpauthUrl: string }>('/admin/auth/mfa/setup', {
      method: 'POST',
      body: { password },
    });
    const qrSvg = await QRCode.toString(r.otpauthUrl, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    return { ok: true, step: 'scan', secret: r.secret, qrSvg };
  } catch (e) {
    return fail(e);
  }
}

/** Step 2: a code from the app turns it on. The recovery codes are shown once. */
export async function enableMfa(code: string): Promise<MfaResult> {
  try {
    const r = await api<{ recoveryCodes: string[] }>('/admin/auth/mfa/enable', {
      method: 'POST',
      body: { code },
    });
    revalidatePath('/', 'layout');
    return { ok: true, step: 'codes', recoveryCodes: r.recoveryCodes };
  } catch (e) {
    return fail(e);
  }
}

export async function newRecoveryCodes(code: string): Promise<MfaResult> {
  try {
    const r = await api<{ recoveryCodes: string[] }>('/admin/auth/mfa/recovery-codes', {
      method: 'POST',
      body: { code },
    });
    revalidatePath('/account');
    return { ok: true, step: 'codes', recoveryCodes: r.recoveryCodes };
  } catch (e) {
    return fail(e);
  }
}

export async function disableMfa(password: string, code: string): Promise<MfaResult> {
  try {
    await api('/admin/auth/mfa/disable', { method: 'POST', body: { password, code } });
    revalidatePath('/', 'layout');
    return { ok: true, step: 'off' };
  } catch (e) {
    return fail(e);
  }
}
