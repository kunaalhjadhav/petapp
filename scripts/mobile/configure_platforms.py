#!/usr/bin/env python3
"""Applies PetApp's Android and iOS settings to the platform folders that `flutter create` generates.

The repo keeps only lib/, test/ and pubspec.yaml for the three Flutter apps; the release workflow (and you, once)
generate android/ and ios/ with `flutter create`, then run this to add permissions, app links, release signing and
the iOS usage texts that each app's README lists. Safe to run again: it only adds what is missing.

  python3 scripts/mobile/configure_platforms.py apps/customer-mobile --domain petapp.in [--release]

  --domain   the website (SHARE_BASE_URL) whose https links open the customer app
  --release  leave out the development-only allowance for http to your local machine (iOS)
"""
import argparse, pathlib, re, sys

ANDROID = 'http://schemas.android.com/apk/res/android'
LINK_PATHS = ['pet', 'reel', 'contest', 'challenge', 'product', 'service', 'booking']
VIEW_QUERIES = ['https', 'http']

APPS = {
    'customer-mobile': {
        'permissions': ['INTERNET', 'POST_NOTIFICATIONS', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
        'dial': False,
        'deep_links': True,
        'ios': {
            'NSPhotoLibraryUsageDescription': 'Choose photos and videos of your pets to share.',
            'NSCameraUsageDescription': 'Take photos and videos of your pets to share.',
            'NSMicrophoneUsageDescription': 'Record sound with your pet videos.',
            'NSLocationWhenInUseUsageDescription': 'Find pet services near you.',
        },
    },
    'service-partner-mobile': {
        'permissions': ['INTERNET', 'POST_NOTIFICATIONS', 'CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
        'dial': True,
        'deep_links': False,
        'ios': {
            'NSCameraUsageDescription': 'Photograph your verification documents.',
            'NSPhotoLibraryUsageDescription': 'Choose photos of your verification documents, or to send to customers and support.',
            'NSLocationWhenInUseUsageDescription': 'Set your business location so nearby customers can find you.',
        },
    },
    'product-partner-mobile': {
        'permissions': ['INTERNET', 'POST_NOTIFICATIONS', 'CAMERA'],
        'dial': True,
        'deep_links': False,
        'ios': {
            'NSCameraUsageDescription': 'Photograph your products and verification documents.',
            'NSPhotoLibraryUsageDescription': 'Choose photos of your products and verification documents, or to send to customers and support.',
        },
    },
}


def android_manifest(path: pathlib.Path, cfg: dict, domain: str, scheme: str) -> list[str]:
    s = path.read_text()
    done = []
    perms = ''.join(f'    <uses-permission android:name="android.permission.{p}"/>\n' for p in cfg['permissions'] if f'android.permission.{p}"' not in s)
    if perms:
        s = re.sub(r'(<manifest[^>]*>\n)', lambda m: m.group(1) + perms, s, count=1)
        done.append('permissions')
    wanted = [f'<intent><action android:name="android.intent.action.VIEW"/><data android:scheme="{x}"/></intent>' for x in VIEW_QUERIES]
    if cfg['dial']:
        wanted.insert(0, '<intent><action android:name="android.intent.action.DIAL"/></intent>')
    missing = [w for w in wanted if w not in s]
    if missing:
        block = ''.join(f'        {w}\n' for w in missing)
        if '<queries>' in s:
            s = s.replace('<queries>\n', '<queries>\n' + block, 1)
        else:
            s = s.replace('</manifest>', f'    <queries>\n{block}    </queries>\n</manifest>', 1)
        done.append('queries')
    if cfg['deep_links'] and 'PETAPP_LINKS' not in s:
        paths = ''.join(f'                <data android:pathPrefix="/{p}/"/>\n' for p in LINK_PATHS)
        filters = f'''            <!-- PETAPP_LINKS: {scheme}:// links and https://{domain}/… app links (lib/services/deep_links.dart) -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="{scheme}"/>
            </intent-filter>
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="https" android:host="{domain}"/>
{paths}            </intent-filter>
            <meta-data android:name="flutter_deeplinking_enabled" android:value="false"/>
'''
        # Inside the main activity, just before it closes.
        i = s.find('android:name=".MainActivity"')
        if i < 0:
            raise SystemExit(f'{path}: no MainActivity found')
        j = s.find('</activity>', i)
        line_start = s.rfind('\n', 0, j) + 1
        s = s[:line_start] + filters + s[line_start:]
        done.append('app links')
    path.write_text(s)
    return done


def android_debug_manifest(path: pathlib.Path) -> list[str]:
    s = path.read_text()
    if 'usesCleartextTraffic' in s:
        return []
    if '<application' in s:
        s = s.replace('<application', '<application android:usesCleartextTraffic="true"', 1)
    else:
        s = s.replace('</manifest>', '    <application android:usesCleartextTraffic="true"/>\n</manifest>', 1)
    path.write_text(s)
    return ['debug: http to the local API']


SIGNING_KTS = '''
// PETAPP_SIGNING: release builds are signed with the upload key in android/key.properties (written by CI from secrets;
// never committed). Without it, release builds fall back to the debug key so `flutter run --release` still works.
val keystoreProperties = java.util.Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
'''
SIGNING_GROOVY = '''
// PETAPP_SIGNING: release builds are signed with the upload key in android/key.properties (written by CI from secrets;
// never committed). Without it, release builds fall back to the debug key so `flutter run --release` still works.
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) { keystorePropertiesFile.withInputStream { keystoreProperties.load(it) } }
'''


def android_signing(path: pathlib.Path) -> list[str]:
    s = path.read_text()
    if 'PETAPP_SIGNING' in s:
        return []
    kts = path.suffix == '.kts'
    head = SIGNING_KTS if kts else SIGNING_GROOVY
    # After the plugins block (or at the top).
    m = re.search(r'^plugins \{.*?^\}\n', s, re.S | re.M)
    s = s[: m.end()] + head + s[m.end():] if m else head + s
    if kts:
        configs = '''    signingConfigs {
        create("release") {
            if (keystoreProperties["storeFile"] != null) {
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
            }
        }
    }
'''
        use = 'signingConfig = if (keystoreProperties["storeFile"] != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")'
        s, n = re.subn(r'signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)', use, s, count=1)
    else:
        configs = '''    signingConfigs {
        release {
            if (keystoreProperties['storeFile']) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
'''
        use = "signingConfig keystoreProperties['storeFile'] ? signingConfigs.release : signingConfigs.debug"
        s, n = re.subn(r'signingConfig\s*=?\s*signingConfigs\.debug', use, s, count=1)
    if not n:
        raise SystemExit(f'{path}: could not find the release signingConfig line from the Flutter template')
    s = re.sub(r'(\nandroid \{\n)', lambda m: m.group(1) + configs, s, count=1)
    path.write_text(s)
    return ['release signing']


def ios_plist(path: pathlib.Path, cfg: dict, scheme: str, release: bool) -> list[str]:
    s = path.read_text()
    add = ''
    for k, v in cfg['ios'].items():
        if f'<key>{k}</key>' not in s:
            add += f'\t<key>{k}</key>\n\t<string>{v}</string>\n'
    if cfg['dial'] and '<key>LSApplicationQueriesSchemes</key>' not in s:
        add += '\t<key>LSApplicationQueriesSchemes</key>\n\t<array>\n\t\t<string>tel</string>\n\t\t<string>https</string>\n\t</array>\n'
    if cfg['deep_links']:
        if '<key>CFBundleURLTypes</key>' not in s:
            add += f'\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>{scheme}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n'
        if '<key>FlutterDeepLinkingEnabled</key>' not in s:
            add += '\t<key>FlutterDeepLinkingEnabled</key>\n\t<false/>\n'
    if not release and '<key>NSAppTransportSecurity</key>' not in s:
        add += '\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t</dict>\n'
    if not add:
        return []
    i = s.rfind('</dict>')
    s = s[:i] + add + s[i:]
    path.write_text(s)
    return ['iOS usage texts and settings']


def ios_entitlements(runner: pathlib.Path, domain: str) -> list[str]:
    """Universal Links: the Associated Domains entitlement. Also tick the capability for the app ID in Apple's portal."""
    path = runner / 'Runner.entitlements'
    entry = f'<string>applinks:{domain}</string>'
    if path.exists() and entry in path.read_text():
        return []
    path.write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.associated-domains</key>
\t<array>
\t\t{entry}
\t</array>
</dict>
</plist>
''')
    pbx = runner.parent / 'Runner.xcodeproj' / 'project.pbxproj'
    if pbx.exists():
        p = pbx.read_text()
        if 'CODE_SIGN_ENTITLEMENTS' not in p:
            p = re.sub(r'(\n(\t+)PRODUCT_BUNDLE_IDENTIFIER = [^;]+;)', lambda m: f'\n{m.group(2)}CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;' + m.group(1), p)
            pbx.write_text(p)
    return ['iOS associated domains']


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('app', help='apps/customer-mobile, apps/service-partner-mobile or apps/product-partner-mobile')
    ap.add_argument('--domain', default='petapp.in')
    ap.add_argument('--scheme', default='petapp')
    ap.add_argument('--release', action='store_true')
    a = ap.parse_args(argv)
    root = pathlib.Path(a.app)
    cfg = APPS.get(root.name)
    if not cfg:
        raise SystemExit(f'Unknown app {root.name}: expected one of {", ".join(APPS)}')
    if not re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', a.domain):
        raise SystemExit(f'--domain must be a bare host name like petapp.in, got {a.domain!r}')
    done = []
    main_manifest = root / 'android/app/src/main/AndroidManifest.xml'
    if main_manifest.exists():
        done += android_manifest(main_manifest, cfg, a.domain, a.scheme)
        debug = root / 'android/app/src/debug/AndroidManifest.xml'
        if debug.exists():
            done += android_debug_manifest(debug)
        gradle = next((p for p in [root / 'android/app/build.gradle.kts', root / 'android/app/build.gradle'] if p.exists()), None)
        if gradle:
            done += android_signing(gradle)
    plist = root / 'ios/Runner/Info.plist'
    if plist.exists():
        done += ios_plist(plist, cfg, a.scheme, a.release)
        if cfg['deep_links']:
            done += ios_entitlements(plist.parent, a.domain)
    if not main_manifest.exists() and not plist.exists():
        raise SystemExit(f'{root}: no android/ or ios/ folder. Run `flutter create .` there first (see its README).')
    print(f'{root.name}: ' + (', '.join(done) if done else 'already configured'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
