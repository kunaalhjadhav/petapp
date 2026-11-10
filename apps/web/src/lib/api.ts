import 'server-only';
import { site } from './site';

/** Pages are rebuilt at most every 5 minutes; photo links from the API stay valid for an hour. */
export const REVALIDATE = 300;

export class ApiUnavailable extends Error {}

/**
 * Reads the public API from the server. Anything not public (404, or 403 for a switched-off feature) is `null`, so
 * the page shows "not found" rather than leaking that it exists.
 */
export async function get<T>(path: string, revalidate = REVALIDATE): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${site.apiUrl}/api/v1${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate },
    });
  } catch (e) {
    throw new ApiUnavailable(`PetApp API unreachable: ${(e as Error).message}`);
  }
  if (res.status === 404 || res.status === 403 || res.status === 400) return null;
  if (!res.ok) throw new ApiUnavailable(`PetApp API answered ${res.status} for ${path}`);
  const body = (await res.json()) as { success: boolean; data: T };
  return body.data;
}
