// Cookie contract shared by middleware (edge) and server code (node). No secrets here.
export const ACCESS_COOKIE = 'pa_at';
export const REFRESH_COOKIE = 'pa_rt';

export const backendUrl = (): string =>
  (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
}

export interface CookieSpec {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: 'strict'; path: '/'; maxAge: number };
}

/** httpOnly + SameSite=Strict: tokens are never readable by page scripts or sent cross-site. */
export function sessionCookies(t: TokenPair): CookieSpec[] {
  const secure = process.env.COOKIE_SECURE === 'true';
  const refreshMaxAge = Math.max(
    0,
    Math.floor((new Date(t.refreshTokenExpiresAt).getTime() - Date.now()) / 1000),
  );
  return [
    {
      name: ACCESS_COOKIE,
      value: t.accessToken,
      options: {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: t.accessTokenExpiresIn,
      },
    },
    {
      name: REFRESH_COOKIE,
      value: t.refreshToken,
      options: { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: refreshMaxAge },
    },
  ];
}

/** Seconds until a JWT expires (without verifying it — the backend verifies). Null if unreadable. */
export function secondsUntilExpiry(jwt: string | undefined, now = Date.now()): number | null {
  if (!jwt) return null;
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp - Math.floor(now / 1000) : null;
  } catch {
    return null;
  }
}
