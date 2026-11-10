// Settings for the public website, read from the environment when each page is rendered (nothing is baked in at build time).

const trim = (s: string | undefined) => (s ?? '').trim().replace(/\/+$/, '');

export const site = {
  /** Where this website is served, e.g. https://petapp.in. Used for canonical URLs, Open Graph and the sitemap. */
  url: trim(process.env.SITE_URL) || 'http://localhost:3001',
  name: 'PetApp',
  /** The API, called from the server only. */
  apiUrl: trim(process.env.API_URL) || 'http://localhost:4000',
  /** Store listings. A button is shown only when its link is set. */
  playStoreUrl: trim(process.env.PLAY_STORE_URL),
  appStoreUrl: trim(process.env.APP_STORE_URL),
  /** The app's own link scheme (petapp://pet/…). */
  appScheme: process.env.APP_SCHEME?.trim() || 'petapp',
  /** Where people write for help, e.g. to delete an account without the app. */
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || '',
  /** Search engines may index the site only when this is "true" (keep staging out of search results). */
  indexable: process.env.SITE_INDEXABLE === 'true',
};

/** Android App Links: the app's package and its signing certificate fingerprints (SHA-256, comma-separated). */
export const androidApp = {
  packageName: process.env.ANDROID_PACKAGE_NAME?.trim() || '',
  fingerprints: (process.env.ANDROID_SHA256_FINGERPRINTS ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

/** iOS Universal Links: "TEAMID.bundle.id". */
export const iosApp = { appId: process.env.IOS_APP_ID?.trim() || '' };

/** Absolute URL on this website. */
export const absolute = (path: string) => `${site.url}${path.startsWith('/') ? path : `/${path}`}`;
