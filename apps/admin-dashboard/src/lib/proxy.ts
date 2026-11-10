import 'server-only';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, backendUrl } from './session';

/**
 * Passes a file download from the API through to the browser with the staff member's token
 * (the token lives in an httpOnly cookie, so the browser can't call the API itself).
 * Only the content type and file name are passed on; nothing is cached.
 */
export async function proxyFile(path: string, loginNext: string): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const login = () =>
    new Response(null, {
      status: 302,
      headers: { Location: `/login?expired=1&next=${encodeURIComponent(loginNext)}` },
    });
  if (!token) return login();
  let res: Response;
  try {
    res = await fetch(`${backendUrl()}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return new Response('The PetApp API is not reachable.', { status: 503 });
  }
  if (res.status === 401) return login();
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    return new Response(json?.message ?? 'Not found', {
      status: res.status === 403 ? 403 : res.status === 404 || res.status === 400 ? 404 : 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const headers = new Headers({
    'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const disposition = res.headers.get('content-disposition');
  if (disposition) headers.set('Content-Disposition', disposition);
  return new Response(res.body, { status: 200, headers });
}
