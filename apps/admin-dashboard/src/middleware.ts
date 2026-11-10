import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  backendUrl,
  secondsUntilExpiry,
  sessionCookies,
  type TokenPair,
} from './lib/session';

const PUBLIC = ['/login', '/forgot-password', '/reset-password'];

/**
 * Gatekeeper for every page: no refresh cookie → login. An access token that is missing or
 * expires within a minute is refreshed here, so server components always see a valid token.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return NextResponse.next();

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  const toLogin = () => {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    const res = NextResponse.redirect(url);
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  };

  if (!refresh) return toLogin();
  const left = secondsUntilExpiry(access);
  if (left !== null && left > 60) return NextResponse.next();

  let tokens: TokenPair | null = null;
  try {
    const r = await fetch(`${backendUrl()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: 'no-store',
    });
    if (r.ok) tokens = (await r.json()).data as TokenPair;
  } catch {
    tokens = null;
  }
  if (!tokens) return toLogin();

  // Hand the new tokens to this request's server components and to the browser.
  const cookies = sessionCookies(tokens);
  const headers = new Headers(req.headers);
  const jar = req.cookies
    .getAll()
    .filter((c) => c.name !== ACCESS_COOKIE && c.name !== REFRESH_COOKIE);
  headers.set(
    'cookie',
    [...jar.map((c) => `${c.name}=${c.value}`), ...cookies.map((c) => `${c.name}=${c.value}`)].join(
      '; ',
    ),
  );
  const res = NextResponse.next({ request: { headers } });
  for (const c of cookies) res.cookies.set(c.name, c.value, c.options);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
