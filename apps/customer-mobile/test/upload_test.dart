import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/services/upload_logic.dart';

import 'fixture.dart';

/// Resumable uploads (Phase 9e, spec §84), against responses recorded from the real API
/// (tool/record_upload_fixtures.py). scripts/check_upload_mirrors.py runs the same checks in Python.
void main() {
  test('small files go in one request, large ones in parts', () {
    final small = UploadTicket.fromJson(fixture('upload_single_create') as Json);
    expect(small.inParts, isFalse);
    expect(small.url, startsWith('http'));
    final big = UploadTicket.fromJson(fixture('upload_multipart_create') as Json);
    expect(big.inParts, isTrue);
    expect(big.url, isEmpty);
    expect(big.partSize, 8 * 1024 * 1024);
    expect(big.partCount, 3);
  });

  test('each part has its own signed address and exact length', () {
    final parts = ((fixture('upload_parts') as Json)['parts'] as List).cast<Json>().map(PartUrl.fromJson).toList();
    expect(parts.map((p) => p.partNumber), [1, 2]);
    expect(parts.every((p) => p.length == 8 * 1024 * 1024), isTrue);
    expect(parts.first.headers['Content-Length'], '${8 * 1024 * 1024}');
    expect(parts.first.url, contains('partNumber=1'));
  });

  test('after an interruption, only the missing parts are sent', () {
    final p = UploadProgress.fromJson(fixture('upload_progress') as Json);
    expect(p.method, 'MULTIPART');
    expect(p.uploaded, [1]);
    expect(p.missing, [2, 3]);
    expect(p.uploadedBytes, p.partSize);
    final size = p.sizeBytes;
    expect(partRange(1, p.partSize, size), (start: 0, end: p.partSize));
    expect(partRange(3, p.partSize, size), (start: 2 * p.partSize, end: size));
    expect(partRange(3, p.partSize, size).end - partRange(3, p.partSize, size).start, size - 2 * p.partSize);
  });

  test('parts are asked for in batches, retried with growing waits', () {
    expect(batchesOf([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    expect(batchesOf([], 10), isEmpty);
    expect([for (var i = 0; i < 7; i++) retryDelay(i).inSeconds], [1, 2, 4, 8, 16, 30, 30]);
    expect([null, 0, 403, 408, 429, 500, 503].every(retryable), isTrue);
    expect([400, 401, 404, 413].any(retryable), isFalse);
    expect(overallProgress(50, 25, 100), 0.75);
    expect(overallProgress(0, 0, 0), 1);
    expect(overallProgress(90, 50, 100), 1);
  });
}
