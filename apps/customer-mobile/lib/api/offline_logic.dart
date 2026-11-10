// Pure rules for offline handling (Phase 10b, spec §84–85). Mirrored in scripts/check_offline_mirrors.py.

/// Screens whose last answer is kept on the phone, so they still show something without a connection. Only reads
/// of the person's own or public lists; never payments, chats or anything that changes often.
const cacheablePaths = <String>[
  r'^/config/flags$',
  r'^/users/me$',
  r'^/pets/mine$',
  r'^/home$',
  r'^/feed$',
  r'^/feed/trending$',
  r'^/notifications$',
  r'^/contests$',
  r'^/challenges$',
  r'^/bookings$',
  r'^/orders$',
  r'^/memberships/me$',
  r'^/users/me/addresses$',
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

/// What people read when something fails. The API's own words for things they can fix (validation, closed
/// registration, not available here); never the server's internals.
String friendlyMessage(int status, String? apiMessage) {
  if (status == 0) return 'No internet connection. Check your network and try again.';
  if (status == 408 || status == 504) return 'The connection is slow. Please try again.';
  if (status == 429) return apiMessage ?? 'Too many tries. Wait a moment and try again.';
  // 503s the API writes for people ("Downloads aren't available right now"); a bare one is a load balancer.
  if (status == 503) return apiMessage ?? 'PetApp is busy right now. Please try again in a moment.';
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  return apiMessage ?? 'Something went wrong. Please try again.';
}

/// How old cached data is, in words, for the offline notice.
String savedAgo(DateTime savedAt, DateTime now) {
  final m = now.difference(savedAt).inMinutes;
  if (m < 1) return 'just now';
  if (m < 60) return '$m min ago';
  final h = m ~/ 60;
  if (h < 24) return '$h h ago';
  return '${h ~/ 24} d ago';
}

/// A payment the gateway took but the API hasn't confirmed yet, because the connection dropped. Kept on the phone and
/// sent again on start and when the app comes back; confirming is safe to repeat. Dropped after [pendingPaymentTtl]:
/// the gateway's own notice to the server settles it by then.
const pendingPaymentTtl = Duration(days: 3);

bool pendingPaymentExpired(DateTime savedAt, DateTime now) => now.difference(savedAt) > pendingPaymentTtl;
