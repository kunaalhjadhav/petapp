/// Build-time configuration (--dart-define). Same API as the customer and partner apps.
class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000');
  static const appVersion = '0.1.0';

  /// Which chat inbox and help center this app shows (Phase 9a).
  static const chatInbox = 'seller';

  /// Push (Phase 9a): on only when Firebase options are passed with --dart-define, as in the customer app.
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
  static const firebaseSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static bool get pushEnabled => firebaseApiKey.isNotEmpty && firebaseAppId.isNotEmpty && firebaseProjectId.isNotEmpty;
}
