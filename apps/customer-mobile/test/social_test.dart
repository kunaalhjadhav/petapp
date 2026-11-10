import 'dart:math';

import 'package:flutter_test/flutter_test.dart';

import 'package:petapp/services/social_logic.dart';

void main() {
  group('which sign-in buttons show', () {
    test('Google on Android, only with the Web client ID', () {
      expect(socialProvidersFor(isWeb: false, isAndroid: true, isIOS: false, googleServerClientId: '123-abc.apps.googleusercontent.com'), [SocialProvider.google]);
      expect(socialProvidersFor(isWeb: false, isAndroid: true, isIOS: false, googleServerClientId: ''), isEmpty);
      expect(socialProvidersFor(isWeb: false, isAndroid: true, isIOS: false, googleServerClientId: '  '), isEmpty);
    });
    test('Apple on iPhone, Google never there', () {
      expect(socialProvidersFor(isWeb: false, isAndroid: false, isIOS: true, googleServerClientId: '123-abc.apps.googleusercontent.com'), [SocialProvider.apple]);
      expect(socialProvidersFor(isWeb: false, isAndroid: false, isIOS: true, googleServerClientId: ''), [SocialProvider.apple]);
    });
    test('nothing on the web build', () {
      expect(socialProvidersFor(isWeb: true, isAndroid: true, isIOS: false, googleServerClientId: 'x'), isEmpty);
      expect(socialProvidersFor(isWeb: true, isAndroid: false, isIOS: true, googleServerClientId: 'x'), isEmpty);
    });
  });

  group('nonce', () {
    test('length and characters', () {
      final n = randomNonce();
      expect(n.length, 32);
      expect(RegExp(r'^[0-9A-Za-z._-]+$').hasMatch(n), isTrue);
      expect(randomNonce(16).length, 16);
      expect(randomNonce(128).length, 128);
      expect(() => randomNonce(15), throwsArgumentError);
      expect(() => randomNonce(129), throwsArgumentError);
    });
    test('differs each time', () {
      final r = Random(7);
      expect(randomNonce(32, r), isNot(randomNonce(32, r)));
    });
    test('sha256 matches the API (Node createHash hex)', () {
      expect(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(sha256Hex('nönce'), 'e47aecd0f3f6b05cee248e0203afef81c2d0e64bc033d45ea144af086bcbc715');
    });
  });

  test('Apple name', () {
    expect(appleDisplayName('Asha', 'Rao'), 'Asha Rao');
    expect(appleDisplayName(' Asha ', null), 'Asha');
    expect(appleDisplayName(null, 'Rao'), 'Rao');
    expect(appleDisplayName('', '  '), isNull);
    expect(appleDisplayName(null, null), isNull);
    expect(appleDisplayName('A' * 90, null)!.length, 80);
  });

  test('Google error messages', () {
    expect(googleErrorMessage('sign_in_failed', 'com.google.android.gms.common.api.ApiException: 10: '), contains('isn’t set up'));
    expect(googleErrorMessage('network_error', null), contains('No internet'));
    expect(googleErrorMessage('sign_in_failed', 'ApiException: 7: '), contains('No internet'));
    expect(googleErrorMessage('sign_in_failed', 'ApiException: 12500: '), contains('didn’t work'));
  });
}
