// Pure helpers for resumable uploads (Phase 9e, spec §84). Mirrored in scripts/check_upload_mirrors.py.

/// The bytes of part [n] (1-based): [start, end).
({int start, int end}) partRange(int n, int partSize, int sizeBytes) {
  final start = (n - 1) * partSize;
  final end = start + partSize > sizeBytes ? sizeBytes : start + partSize;
  return (start: start, end: end);
}

/// Part numbers in groups, so addresses are asked for a few at a time (they expire).
List<List<int>> batchesOf(List<int> parts, [int size = 10]) => [for (var i = 0; i < parts.length; i += size) parts.sublist(i, i + size > parts.length ? parts.length : i + size)];

/// How long to wait before trying a part again: 1, 2, 4, 8, 16 seconds, then 30.
Duration retryDelay(int attempt) => Duration(seconds: attempt >= 5 ? 30 : 1 << attempt);

/// Whether a failed part is worth sending again: no answer (the connection dropped or timed out), a server error,
/// being asked to slow down, or an address that expired (403: a fresh one is fetched).
bool retryable(int? statusCode) => statusCode == null || statusCode == 0 || statusCode == 403 || statusCode == 408 || statusCode == 429 || statusCode >= 500;

/// Overall progress (0..1) of files sent in order: bytes of finished files, plus this file's bytes so far.
double overallProgress(int doneBytes, int currentBytes, int totalBytes) => totalBytes <= 0 ? 1 : ((doneBytes + currentBytes) / totalBytes).clamp(0, 1).toDouble();
