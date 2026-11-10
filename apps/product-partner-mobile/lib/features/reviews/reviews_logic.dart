// Pure helpers for reviews and ratings (Phase 9b). The same file in the customer, partner and seller apps;
// scripts/check_reviews_mirrors.py checks the copies match and mirrors these functions in Python.

/// Photos on one review, and screenshots on one report (the API's limits).
const reviewPhotoMax = 4;
const reportEvidenceMax = 3;

/// 4 → "★★★★☆".
String starsText(int rating) {
  final n = rating.clamp(0, 5);
  return '${'★' * n}${'☆' * (5 - n)}';
}

/// "★ 4.5 · 12 reviews", or "No reviews yet".
String ratingLine(double avg, int count) => count == 0 ? 'No reviews yet' : '★ ${avg.toStringAsFixed(1)} · $count review${count == 1 ? '' : 's'}';

/// The word under the stars while choosing.
String ratingWord(int rating) => const ['Tap a star', 'Poor', 'Not great', 'OK', 'Good', 'Excellent'][rating.clamp(0, 5)];

/// A prompt for the text box that fits the stars chosen.
String reviewHint(int rating) {
  if (rating >= 5) return 'What did you love? (optional)';
  if (rating == 4) return 'What was good? Anything to improve? (optional)';
  if (rating == 3) return 'What could have been better? (optional)';
  return 'What went wrong? It helps others, and the business. (optional)';
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Today", "Yesterday", "3 days ago", "12 Mar", or "12 Mar 2025" for another year.
String reviewDate(DateTime at, DateTime now) {
  final a = at.toLocal(), n = now.toLocal();
  final days = DateTime(n.year, n.month, n.day).difference(DateTime(a.year, a.month, a.day)).inDays;
  if (days <= 0) return 'Today';
  if (days == 1) return 'Yesterday';
  if (days < 7) return '$days days ago';
  return a.year == n.year ? '${a.day} ${_months[a.month - 1]}' : '${a.day} ${_months[a.month - 1]} ${a.year}';
}

/// Filters for a reviews list: "all", "5".."1", or "photos" → the query to send.
Map<String, Object?> reviewFilter(String key) {
  if (key == 'photos') return {'photos': 'true'};
  final n = int.tryParse(key);
  return n != null && n >= 1 && n <= 5 ? {'stars': n} : const {};
}

/// Why a reply can't be sent yet, or null when it can.
String? replyProblem(String text) {
  final t = text.trim();
  if (t.length < 2) return 'Write a reply first.';
  if (t.length > 1000) return 'Keep it under 1,000 characters.';
  return null;
}

/// The share of reviews with each number of stars, as whole percentages that add up to 100 (or all 0).
List<int> starShares(List<int> countsFiveToOne) {
  final total = countsFiveToOne.fold<int>(0, (a, b) => a + b);
  if (total == 0) return List.filled(countsFiveToOne.length, 0);
  final raw = [for (final c in countsFiveToOne) c * 100 / total];
  final out = [for (final r in raw) r.floor()];
  // Hand the remaining points to the largest remainders, so the bars' labels add up.
  final order = List.generate(raw.length, (i) => i)
    ..sort((x, y) {
      final c = (raw[y] - out[y]).compareTo(raw[x] - out[x]);
      return c != 0 ? c : x.compareTo(y); // ties: more stars first
    });
  var left = 100 - out.fold<int>(0, (a, b) => a + b);
  for (final i in order) {
    if (left == 0) break;
    out[i]++;
    left--;
  }
  return out;
}
