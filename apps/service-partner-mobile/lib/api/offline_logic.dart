// Offline rules (Phase 10b, spec §84), the same as the customer app's lib/api/offline_logic.dart.
// Mirrored in scripts/check_offline_mirrors.py.

/// Screens whose last answer is kept on the phone, so they still show something without a connection: this
/// business's own profile and lists. Never money (earnings, payouts, statements) or chats.
const cacheablePaths = <String>[
  r'^/users/me$',
  r'^/partner/profile$',
  r'^/service-categories$',
  r'^/partner/bookings$',
  r'^/partner/reviews/summary$',
];

/// The key a cached answer is kept under: the path and its query, in a fixed order. Paged reads beyond the first
/// page aren't kept (a cursor or page > 1).
String? cacheKey(String path, Map<String, Object?>? query) {
  if (!cacheablePaths.any((p) => RegExp(p).hasMatch(path))) return null;
  final q = Map<String, Object?>.of(query ?? const {})..removeWhere((_, v) => v == null);
  if (q.containsKey('cursor') || (q['page'] != null && '${q['page']}' != '1')) return null;
  final parts = q.keys.toList()..sort();
  return parts.isEmpty ? path : '$path?${parts.map((k) => '$k=${q[k]}').join('&')}';
}

/// Waits before trying a read again after the connection dropped. Writes are never retried automatically: the app
/// can't know whether the server already did them.
List<Duration> retryDelaysFor(String method) => method == 'GET' ? const [Duration(milliseconds: 400), Duration(milliseconds: 1200)] : const [];

/// How old cached data is, in words, for the offline notice.
String savedAgo(DateTime savedAt, DateTime now) {
  final m = now.difference(savedAt).inMinutes;
  if (m < 1) return 'just now';
  if (m < 60) return '$m min ago';
  final h = m ~/ 60;
  if (h < 24) return '$h h ago';
  return '${h ~/ 24} d ago';
}
