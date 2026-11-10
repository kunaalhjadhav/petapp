// Global search and discovery (Phase 9c): pure helpers, mirrored in scripts/check_search_mirrors.py.

/// The kinds of search result, in the order the tabs show them.
const searchTypeOrder = ['pets', 'users', 'reels', 'products', 'services', 'partners', 'contests', 'challenges'];

String searchTypeLabel(String type) => const {
      'pets': 'Pets',
      'users': 'People',
      'reels': 'Reels',
      'products': 'Shop',
      'services': 'Services',
      'partners': 'Businesses',
      'contests': 'Contests',
      'challenges': 'Challenges',
    }[type] ??
    type;

/// Where a result opens (the same paths deep links use).
String? hitRoute(String kind, String key) {
  if (key.isEmpty) return null;
  return switch (kind) {
    'pet' => '/pet/$key',
    'user' => '/user/$key',
    'reel' => '/post/$key',
    'product' => '/product/$key',
    'service' => '/service-partner/$key',
    'contest' => '/contest/$key',
    'challenge' => '/challenge/$key',
    _ => null,
  };
}

int? _int(Object? v) => v is num ? v.toInt() : null;

/// The short fact on the right of a result: price, rating, distance, entries…
String? hitTrailing(String type, Map<String, Object?> meta, String Function(int paise) money) {
  final distance = meta['distance'] as String?;
  String join(List<String?> parts) => parts.whereType<String>().where((s) => s.isNotEmpty).join(' · ');
  switch (type) {
    case 'PRODUCT':
      final p = _int(meta['fromPaise']);
      return p == null ? null : money(p);
    case 'SERVICE':
      final p = _int(meta['pricePaise']);
      return join([p == null ? null : money(p), distance]);
    case 'PARTNER':
      final n = _int(meta['ratingCount']) ?? 0;
      final avg = (meta['ratingAvg'] as num?)?.toDouble() ?? 0;
      return join([n > 0 ? '★ ${avg.toStringAsFixed(1)}' : null, distance]);
    case 'CONTEST':
      final n = _int(meta['entries']) ?? 0;
      return '$n entr${n == 1 ? 'y' : 'ies'}';
    case 'CHALLENGE':
      final n = _int(meta['participants']) ?? 0;
      return '$n taking part';
    case 'PET':
      final n = _int(meta['followers']) ?? 0;
      return n > 0 ? '$n follower${n == 1 ? '' : 's'}' : null;
    case 'REEL':
      final n = _int(meta['likes']) ?? 0;
      return n > 0 ? '♥ $n' : null;
    default:
      return null;
  }
}

/// Which filters a kind offers in the app.
Set<String> filtersOf(String type) => switch (type) {
      'pets' => {'species'},
      'products' => {'category', 'species', 'inStock'},
      'services' => {'category', 'mode', 'near'},
      'partners' => {'category', 'near'},
      'contests' => {'category', 'when'},
      'challenges' => {'when'},
      _ => const {},
    };

/// The query parameters for the chosen filters, keeping only those the kind uses.
Map<String, Object?> filterQuery(String type, {String? speciesId, String? categoryId, String? mode, String? when, bool inStock = false, double? lat, double? lng}) {
  final f = filtersOf(type);
  return {
    if (f.contains('species') && speciesId != null) 'speciesId': speciesId,
    if (f.contains('category') && categoryId != null) 'categoryId': categoryId,
    if (f.contains('mode') && mode != null) 'mode': mode,
    if (f.contains('when') && when != null) 'when': when,
    if (f.contains('inStock') && inStock) 'inStock': 'true',
    if (f.contains('near') && lat != null && lng != null) ...{'lat': lat, 'lng': lng},
  };
}

/// Recent searches: newest first, no repeats (ignoring case), at most [max].
List<String> addRecent(List<String> recent, String q, {int max = 8}) {
  final t = q.trim();
  if (t.length < 2) return recent;
  return [t, ...recent.where((r) => r.toLowerCase() != t.toLowerCase())].take(max).toList();
}

/// "Within 1 km", "3 km away" for a nearby pet (distances are rounded up by the server).
String petDistanceLabel(int? km) => km == null ? '' : km <= 1 ? 'Within 1 km' : '$km km away';

/// "4 of 7 check-ins", or "Completed".
String challengeProgress(int checkIns, int required, {bool completed = false}) => completed ? 'Completed' : '$checkIns of $required check-ins';

/// Rounds a position to about 1 km (2 decimal places) before it's saved for a pet: enough for "nearby", not a home.
({double lat, double lng}) coarsePoint(double lat, double lng) => (lat: (lat * 100).round() / 100, lng: (lng * 100).round() / 100);
