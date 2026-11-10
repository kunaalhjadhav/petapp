// Links between the website and the apps. The same paths work on both: https://<site>/pet/bruno opens the app when
// it is installed (App Links / Universal Links), and petapp://pet/bruno opens it directly.

export type LinkKind =
  'pet' | 'reel' | 'contest' | 'challenge' | 'product' | 'service' | 'booking' | 'legal';

/** Path segments that are app links (the apps' association files list exactly these). */
export const APP_LINK_PREFIXES: LinkKind[] = [
  'pet',
  'reel',
  'contest',
  'challenge',
  'product',
  'service',
  'booking',
];

/** The website path for a thing. Keys are a pet's handle, a slug, or an id. */
export function webPath(kind: LinkKind, key: string): string {
  return `/${kind}/${encodeURIComponent(key)}`;
}

/** The app link for a thing, e.g. petapp://pet/bruno. */
export function appUrl(scheme: string, kind: LinkKind, key: string): string {
  return `${scheme}://${kind}/${encodeURIComponent(key)}`;
}
