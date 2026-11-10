"""Runs configure_platforms.py against copies of the files `flutter create` generates (Flutter 3.24+ templates),
checks the result is well-formed and complete, and that a second run changes nothing.
Usage: python3 scripts/mobile/tests/test_configure_platforms.py
"""
import pathlib, plistlib, shutil, sys, tempfile, unittest
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import configure_platforms as cp  # noqa: E402

A = '{http://schemas.android.com/apk/res/android}'


def make_app(base: pathlib.Path, name: str, gradle: str) -> pathlib.Path:
    root = base / name
    shutil.copytree(HERE / 'flutter_template', root)
    g = root / 'android/app' / gradle
    (root / 'android/app').joinpath('build.gradle.kts' if gradle.endswith('kts') else 'build.gradle')
    for other in ['build.gradle.kts', 'build.gradle']:
        if other != gradle:
            (root / 'android/app' / other).unlink()
    assert g.exists()
    return root


class ConfigureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_script(self, root, *extra):
        cp.main([str(root), '--domain', 'petapp.in', *extra])

    def snapshot(self, root):
        return {p: p.read_text() for p in root.rglob('*') if p.is_file()}

    def test_customer_app(self):
        root = make_app(self.tmp, 'customer-mobile', 'build.gradle.kts')
        self.run_script(root)
        man = ET.parse(root / 'android/app/src/main/AndroidManifest.xml').getroot()
        perms = {e.get(A + 'name') for e in man.findall('uses-permission')}
        self.assertTrue({'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS', 'android.permission.ACCESS_FINE_LOCATION'} <= perms)
        activity = man.find('application/activity')
        filters = activity.findall('intent-filter')
        schemes = [d.get(A + 'scheme') for f in filters for d in f.findall('data') if d.get(A + 'scheme')]
        self.assertIn('petapp', schemes)
        verified = [f for f in filters if f.get(A + 'autoVerify') == 'true']
        self.assertEqual(len(verified), 1)
        prefixes = [d.get(A + 'pathPrefix') for d in verified[0].findall('data') if d.get(A + 'pathPrefix')]
        self.assertEqual(prefixes, [f'/{p}/' for p in cp.LINK_PATHS])
        self.assertEqual(verified[0].find('data').get(A + 'host'), 'petapp.in')
        meta = {m.get(A + 'name'): m.get(A + 'value') for m in activity.findall('meta-data')}
        self.assertEqual(meta.get('flutter_deeplinking_enabled'), 'false')
        debug = ET.parse(root / 'android/app/src/debug/AndroidManifest.xml').getroot()
        self.assertEqual(debug.find('application').get(A + 'usesCleartextTraffic'), 'true')
        gradle = (root / 'android/app/build.gradle.kts').read_text()
        self.assertIn('create("release")', gradle)
        self.assertIn('signingConfigs.getByName("release") else signingConfigs.getByName("debug")', gradle)
        plist = plistlib.loads((root / 'ios/Runner/Info.plist').read_bytes())
        self.assertEqual(plist['CFBundleURLTypes'][0]['CFBundleURLSchemes'], ['petapp'])
        self.assertIs(plist['FlutterDeepLinkingEnabled'], False)
        self.assertIn('NSCameraUsageDescription', plist)
        self.assertTrue(plist['NSAppTransportSecurity']['NSAllowsLocalNetworking'])
        ent = plistlib.loads((root / 'ios/Runner/Runner.entitlements').read_bytes())
        self.assertEqual(ent['com.apple.developer.associated-domains'], ['applinks:petapp.in'])
        self.assertIn('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;', (root / 'ios/Runner.xcodeproj/project.pbxproj').read_text())
        # A second run changes nothing.
        before = self.snapshot(root)
        self.run_script(root)
        self.assertEqual(before, self.snapshot(root))

    def test_partner_app_with_groovy_gradle_and_release(self):
        root = make_app(self.tmp, 'service-partner-mobile', 'build.gradle')
        self.run_script(root, '--release')
        man = ET.parse(root / 'android/app/src/main/AndroidManifest.xml').getroot()
        perms = {e.get(A + 'name') for e in man.findall('uses-permission')}
        self.assertIn('android.permission.CAMERA', perms)
        self.assertEqual(len(man.findall('queries')), 1)
        actions = [a.get(A + 'name') for a in man.iter('action')]
        self.assertIn('android.intent.action.DIAL', actions)
        # No app links for the partner app.
        self.assertNotIn('PETAPP_LINKS', (root / 'android/app/src/main/AndroidManifest.xml').read_text())
        gradle = (root / 'android/app/build.gradle').read_text()
        self.assertIn("signingConfig keystoreProperties['storeFile'] ? signingConfigs.release : signingConfigs.debug", gradle)
        plist = plistlib.loads((root / 'ios/Runner/Info.plist').read_bytes())
        self.assertEqual(plist['LSApplicationQueriesSchemes'], ['tel', 'https'])
        self.assertNotIn('NSAppTransportSecurity', plist)  # --release
        self.assertFalse((root / 'ios/Runner/Runner.entitlements').exists())

    def test_refuses_bad_input(self):
        root = make_app(self.tmp, 'product-partner-mobile', 'build.gradle.kts')
        with self.assertRaises(SystemExit):
            cp.main([str(root), '--domain', 'https://petapp.in/'])
        with self.assertRaises(SystemExit):
            cp.main([str(self.tmp / 'other-app')])


if __name__ == '__main__':
    unittest.main(verbosity=1)
