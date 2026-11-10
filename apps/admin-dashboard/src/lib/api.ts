import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { PageMeta } from '@petapp/types';
import { ACCESS_COOKIE, backendUrl } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: Array<{ field?: string; message: string }> = [],
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Send without a token (login). */
  anonymous?: boolean;
}

function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function call<T>(
  path: string,
  o: Options = {},
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!o.anonymous) {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!token) redirect('/login');
    headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${backendUrl()}/api/v1${path}${qs(o.query)}`, {
      method: o.method ?? 'GET',
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(503, 'The PetApp API is not reachable. Check that the backend is running.');
  }
  if (res.status === 204) return { data: undefined as T, meta: {} }; // deleted, nothing to return
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    if (res.status === 401 && !o.anonymous) redirect('/login?expired=1');
    // Phase 10a: staff must set up two-factor sign-in before anything else.
    if (res.status === 403 && !o.anonymous && json?.errors?.some((e: { code?: string }) => e.code === 'MFA_SETUP_REQUIRED')) redirect('/account?mfa=required');
    throw new ApiError(
      res.status,
      json?.message ?? `Request failed (${res.status})`,
      json?.errors ?? [],
    );
  }
  return { data: json.data as T, meta: json.meta ?? {} };
}

export async function api<T>(path: string, o?: Options): Promise<T> {
  return (await call<T>(path, o)).data;
}

export async function apiPage<T>(
  path: string,
  query: Query,
): Promise<{ items: T[]; meta: PageMeta }> {
  const r = await call<T[]>(path, { query });
  return { items: r.data, meta: r.meta as unknown as PageMeta };
}

/** Result shape returned by server actions to forms. */
export type ActionState = { ok: boolean; message: string; at?: number } | null;

/** Runs a mutation and turns API errors into a message the form can show. */
export async function act(fn: () => Promise<unknown>, success: string): Promise<ActionState> {
  try {
    await fn();
    return { ok: true, message: success, at: Date.now() };
  } catch (e) {
    if (e instanceof ApiError) {
      const detail = e.errors.map((x) => x.message).filter((m) => !/^attemptsLeft=/.test(m));
      return {
        ok: false,
        message: detail.length && e.message === 'Validation failed' ? detail.join('. ') : e.message,
        at: Date.now(),
      };
    }
    throw e; // redirects and unexpected errors
  }
}
