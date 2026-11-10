import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../api/offline_cache.dart';

/// Kept on the phone (shared preferences): at most [maxEntries] answers of up to [maxBytes] each, the oldest
/// dropped first. Cleared when someone signs out, so the next person never sees it.
class PrefsOfflineCache implements OfflineCache {
  PrefsOfflineCache({this.maxEntries = 40, this.maxBytes = 256 * 1024});
  final int maxEntries;
  final int maxBytes;
  static const _prefix = 'offline:';
  static const _index = 'offline:index';

  Future<SharedPreferences> get _p => SharedPreferences.getInstance();

  @override
  Future<String?> read(String key) async => (await _p).getString('$_prefix$key');

  @override
  Future<void> write(String key, String value) async {
    if (utf8.encode(value).length > maxBytes) return;
    final p = await _p;
    final keys = (p.getStringList(_index) ?? <String>[])..remove(key)..add(key);
    while (keys.length > maxEntries) {
      await p.remove('$_prefix${keys.removeAt(0)}');
    }
    await p.setString('$_prefix$key', value);
    await p.setStringList(_index, keys);
  }

  @override
  Future<void> clear() async {
    final p = await _p;
    for (final k in p.getStringList(_index) ?? const <String>[]) {
      await p.remove('$_prefix$k');
    }
    await p.remove(_index);
  }
}
