import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// Pure rules for "Continue with Google" and "Sign in with Apple" (no plugins, so tests run anywhere).
/// Mirrored in scripts/check_social_mirrors.py.

enum SocialProvider { google, apple }

/// Which buttons this phone shows: Google on Android (only when the app was built with the Web client ID, which the
/// API checks the token against), Apple on iPhone. Web builds show neither.
List<SocialProvider> socialProvidersFor({required bool isWeb, required bool isAndroid, required bool isIOS, required String googleServerClientId}) => [
      if (!isWeb && isAndroid && googleServerClientId.trim().isNotEmpty) SocialProvider.google,
      if (!isWeb && isIOS) SocialProvider.apple,
    ];

const _nonceChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';

/// A one-time random value for Sign in with Apple: Apple gets its SHA-256, the API gets the value itself and checks
/// they match, so a stolen Apple token can't be replayed. The API accepts 16–128 characters.
String randomNonce([int length = 32, Random? random]) {
  if (length < 16 || length > 128) throw ArgumentError.value(length, 'length', 'must be 16–128');
  final r = random ?? Random.secure();
  return List.generate(length, (_) => _nonceChars[r.nextInt(_nonceChars.length)]).join();
}

/// Lower-case hex SHA-256, as the API computes it.
String sha256Hex(String input) => sha256.convert(utf8.encode(input)).toString();

/// Apple shares the name only the first time someone signs in to the app; null when it didn't.
String? appleDisplayName(String? givenName, String? familyName) {
  final parts = [givenName, familyName].map((s) => (s ?? '').trim()).where((s) => s.isNotEmpty);
  final name = parts.join(' ');
  if (name.isEmpty) return null;
  return name.length > 80 ? name.substring(0, 80).trim() : name;
}

/// What to tell the person when Google's sign-in on the phone itself fails (not when they cancel).
/// [code] is the plugin's error code, [message] its text, which carries Google's status code ("ApiException: 10").
String googleErrorMessage(String code, String? message) {
  final m = message ?? '';
  if (code == 'network_error' || m.contains('ApiException: 7')) return 'No internet connection. Check it and try again.';
  if (m.contains('ApiException: 10')) {
    // DEVELOPER_ERROR: the app's package name or signing key (SHA-1) isn't registered in Google Cloud.
    return 'Google sign-in isn’t set up for this version of the app yet. Use your mobile number instead.';
  }
  return 'Google sign-in didn’t work. Please try again, or use your mobile number.';
}
