import { androidApp } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** Android App Links: proves this site belongs to the app, so https links open it without asking. */
export function GET() {
  const body =
    androidApp.packageName && androidApp.fingerprints.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: androidApp.packageName,
              sha256_cert_fingerprints: androidApp.fingerprints,
            },
          },
        ]
      : [];
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
