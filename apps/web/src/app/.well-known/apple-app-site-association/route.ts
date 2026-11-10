import { APP_LINK_PREFIXES } from '@/lib/links';
import { iosApp } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** iOS Universal Links: which paths open the app. Served as JSON without a file extension, as Apple requires. */
export function GET() {
  const details = iosApp.appId
    ? [{ appIDs: [iosApp.appId], components: APP_LINK_PREFIXES.map((p) => ({ '/': `/${p}/*` })) }]
    : [];
  return Response.json(
    { applinks: { details } },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
