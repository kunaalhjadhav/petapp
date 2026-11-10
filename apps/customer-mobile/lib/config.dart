/// Build-time configuration, passed with --dart-define (see README).
class AppConfig {
  /// The PetApp API. Android emulator reaches the host at 10.0.2.2; a real phone needs your machine's LAN IP.
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000');

  // Firebase (push). Push stays off unless all of these are set.
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
  static const firebaseSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');

  static bool get pushEnabled =>
      firebaseApiKey.isNotEmpty && firebaseAppId.isNotEmpty && firebaseSenderId.isNotEmpty && firebaseProjectId.isNotEmpty;

  static const appVersion = '0.1.0';

  /// Google sign-in (Android): the OAuth *Web* client ID from Google Cloud, the same one the API lists in
  /// GOOGLE_CLIENT_IDS. Without it the "Continue with Google" button is hidden. Sign in with Apple needs no setting.
  static const googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
}
