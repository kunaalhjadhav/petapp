import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../config.dart';
import 'social_logic.dart';

export 'social_logic.dart' show SocialProvider;

/// What the phone's Google or Apple sign-in hands back, for the API's /auth/google or /auth/apple.
class SocialCredential {
  const SocialCredential.google(this.token)
      : provider = SocialProvider.google,
        nonce = null,
        name = null;
  const SocialCredential.apple(this.token, {required String this.nonce, this.name}) : provider = SocialProvider.apple;

  final SocialProvider provider;

  /// Google's ID token, or Apple's identityToken.
  final String token;

  /// Apple only: the raw nonce whose SHA-256 Apple put in the token.
  final String? nonce;

  /// Apple only, and only the first time: the name the person shared.
  final String? name;
}

/// A sign-in problem on the phone, before the API is reached. [message] is for the person.
class SocialSignInError implements Exception {
  const SocialSignInError(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Google sign-in on Android and Sign in with Apple on iPhone.
class SocialSignIn {
  SocialSignIn._();

  /// The buttons to show on this phone.
  static List<SocialProvider> get available => socialProvidersFor(
        isWeb: kIsWeb,
        isAndroid: defaultTargetPlatform == TargetPlatform.android,
        isIOS: defaultTargetPlatform == TargetPlatform.iOS,
        googleServerClientId: AppConfig.googleServerClientId,
      );

  static GoogleSignIn? _google;

  /// Null when the person closes the account picker.
  static Future<SocialCredential?> google() async {
    // serverClientId is the *Web* client ID: Google then issues an ID token for it, which the API verifies.
    final g = _google ??= GoogleSignIn(scopes: const ['email', 'profile'], serverClientId: AppConfig.googleServerClientId);
    try {
      // Forget the last choice so the account picker always shows (people often have several Google accounts).
      await g.signOut();
      final account = await g.signIn();
      if (account == null) return null;
      final idToken = (await account.authentication).idToken;
      if (idToken == null) throw const SocialSignInError('Google didn’t confirm your account. Please try again.');
      return SocialCredential.google(idToken);
    } on PlatformException catch (e) {
      if (e.code == GoogleSignIn.kSignInCanceledError) return null;
      throw SocialSignInError(googleErrorMessage(e.code, e.message));
    }
  }

  /// Null when the person cancels.
  static Future<SocialCredential?> apple() async {
    final nonce = randomNonce();
    try {
      final c = await SignInWithApple.getAppleIDCredential(
        scopes: const [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
        nonce: sha256Hex(nonce),
      );
      final token = c.identityToken;
      if (token == null) throw const SocialSignInError('Apple didn’t confirm your account. Please try again.');
      return SocialCredential.apple(token, nonce: nonce, name: appleDisplayName(c.givenName, c.familyName));
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code == AuthorizationErrorCode.canceled) return null;
      throw const SocialSignInError('Sign in with Apple didn’t work. Please try again, or use your mobile number.');
    } on SignInWithAppleNotSupportedException {
      throw const SocialSignInError('Sign in with Apple needs iOS 13 or later. Use your mobile number instead.');
    }
  }

  /// Signs out of Google on this phone too, so the next person sees the account picker.
  static Future<void> signOut() async {
    try {
      await _google?.signOut();
    } catch (_) {
      // Not signed in with Google; nothing to do.
    }
  }
}
