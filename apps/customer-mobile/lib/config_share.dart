/// The public website, which is also the app-link domain: https://<site>/pet/bruno opens the app when it is installed.
const shareBaseUrl = String.fromEnvironment('SHARE_BASE_URL', defaultValue: 'https://petapp.example');

/// The app's own link scheme (petapp://pet/bruno).
const appLinkScheme = String.fromEnvironment('APP_LINK_SCHEME', defaultValue: 'petapp');

/// Things that can be shared, as the website names them.
enum ShareKind { pet, reel, contest, challenge, product, service }

/// The link to share for a thing. Keys are a pet's handle, a slug or an id; the website and the app accept any.
String shareLink(ShareKind kind, String key) => '$shareBaseUrl/${kind.name}/${Uri.encodeComponent(key)}';
