/// Where the last answers of some screens are kept, to show without a connection (Phase 10b).
abstract class OfflineCache {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> clear();
}

/// In memory only: tests, and as a fallback.
class MemoryOfflineCache implements OfflineCache {
  final _m = <String, String>{};
  @override
  Future<String?> read(String key) async => _m[key];
  @override
  Future<void> write(String key, String value) async => _m[key] = value;
  @override
  Future<void> clear() async => _m.clear();
}
