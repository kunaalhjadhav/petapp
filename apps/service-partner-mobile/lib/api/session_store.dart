import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tokens live in the platform keystore (Keychain / Android Keystore), never in plain prefs.
class SessionStore {
  SessionStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  /// Keeps tokens in memory only (tests).
  SessionStore.memory() : _s = null;

  final FlutterSecureStorage? _s;

  String? accessToken;
  String? refreshToken;

  Future<void> load() async {
    final s = _s;
    if (s == null) return;
    accessToken = await s.read(key: 'at');
    refreshToken = await s.read(key: 'rt');
  }

  Future<void> save(String access, String refresh) async {
    accessToken = access;
    refreshToken = refresh;
    await _s?.write(key: 'at', value: access);
    await _s?.write(key: 'rt', value: refresh);
  }

  Future<void> clear() async {
    accessToken = null;
    refreshToken = null;
    await _s?.delete(key: 'at');
    await _s?.delete(key: 'rt');
  }

  bool get hasSession => refreshToken != null;
}
