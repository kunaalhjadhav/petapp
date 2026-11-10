import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/api_client.dart';
import 'package:petapp/api/offline_cache.dart';
import 'package:petapp/api/offline_logic.dart';
import 'package:petapp/api/session_store.dart';

import 'fixture.dart';

/// Answers from a script; `null` means the connection dropped.
class FlakyAdapter implements HttpClientAdapter {
  FlakyAdapter(this.answers);
  final List<(int, String)?> answers;
  final calls = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    calls.add(o);
    final a = answers.isEmpty ? null : answers.removeAt(0);
    if (a == null) throw DioException(requestOptions: o, type: DioExceptionType.connectionError);
    return ResponseBody.fromString(a.$2, a.$1, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

ApiClient client(FlakyAdapter a, {OfflineCache? cache}) =>
    ApiClient(baseUrl: 'http://api', session: SessionStore.memory(), adapter: a, cache: cache, retryDelays: (m) => m == 'GET' ? const [Duration.zero, Duration.zero] : const []);

/// Offline handling and friendly errors (Phase 10b, spec §84–85). scripts/check_offline_mirrors.py runs the same rules in Python.
void main() {
  test('which reads are kept for offline', () {
    expect(cacheKey('/users/me', null), '/users/me');
    expect(cacheKey('/contests', {'when': 'open', 'limit': 50}), '/contests?limit=50&when=open');
    expect(cacheKey('/notifications', {'cursor': null}), '/notifications');
    expect(cacheKey('/notifications', {'cursor': 'abc'}), isNull);
    expect(cacheKey('/orders', {'page': 2}), isNull);
    expect(cacheKey('/payments/x', null), isNull);
    expect(cacheKey('/chat/conversations', null), isNull);
  });

  test('a dropped read is tried again; a write is not', () async {
    final a = FlakyAdapter([null, (200, fixtureRaw('me'))]);
    final c = client(a);
    expect(await c.get('/users/me'), isA<Map<dynamic, dynamic>>());
    expect(a.calls, hasLength(2));
    final w = FlakyAdapter([null, (200, fixtureRaw('me'))]);
    await expectLater(client(w).post('/posts', {}), throwsA(isA<ApiException>().having((e) => e.isOffline, 'offline', isTrue)));
    expect(w.calls, hasLength(1));
  });

  test('offline, the saved answer is shown and marked', () async {
    final cache = MemoryOfflineCache();
    final c = client(FlakyAdapter([(200, fixtureRaw('me')), null, null, null, (200, fixtureRaw('me'))]), cache: cache);
    final first = await c.get('/users/me');
    expect(c.offlineSince.value, isNull);
    expect(await c.get('/users/me'), first);
    expect(c.offlineSince.value, isNotNull);
    await c.get('/users/me');
    expect(c.offlineSince.value, isNull, reason: 'back online');
  });

  test('nothing saved: the offline error', () async {
    final c = client(FlakyAdapter([null, null, null]), cache: MemoryOfflineCache());
    await expectLater(c.get('/users/me'), throwsA(isA<ApiException>().having((e) => e.message, 'message', startsWith('No internet'))));
  });

  test('server faults never show internals; messages written for people are kept', () async {
    String env(String m) => jsonEncode({'success': false, 'message': m, 'errors': [{'message': 'at prisma.ts:42'}]});
    final c = client(FlakyAdapter([(500, env('relation "x" does not exist')), (503, env('Downloads aren’t available right now. Please try again later.')), (400, fixtureRaw('error_validation'))]));
    await expectLater(c.get('/a'), throwsA(isA<ApiException>().having((e) => e.message, 'm', 'Something went wrong on our side. Please try again in a moment.').having((e) => e.fields, 'f', isEmpty)));
    await expectLater(c.get('/b'), throwsA(isA<ApiException>().having((e) => e.message, 'm', startsWith('Downloads'))));
    await expectLater(c.post('/c', {}), throwsA(isA<ApiException>().having((e) => e.fields, 'f', isNotEmpty)));
  });

  test('friendly messages and how old saved data is', () {
    expect(friendlyMessage(0, null), startsWith('No internet'));
    expect(friendlyMessage(504, null), 'The connection is slow. Please try again.');
    expect(friendlyMessage(502, 'Bad gateway'), 'Something went wrong on our side. Please try again in a moment.');
    expect(friendlyMessage(503, null), startsWith('PetApp is busy'));
    expect(friendlyMessage(429, null), startsWith('Too many tries'));
    expect(friendlyMessage(404, 'Pet not found.'), 'Pet not found.');
    final now = DateTime(2026, 10, 24, 12);
    expect(savedAgo(now.subtract(const Duration(seconds: 20)), now), 'just now');
    expect(savedAgo(now.subtract(const Duration(minutes: 5)), now), '5 min ago');
    expect(savedAgo(now.subtract(const Duration(hours: 3)), now), '3 h ago');
    expect(savedAgo(now.subtract(const Duration(days: 2)), now), '2 d ago');
    expect(retryDelaysFor('GET'), hasLength(2));
    expect(retryDelaysFor('POST'), isEmpty);
    expect(pendingPaymentExpired(now.subtract(const Duration(days: 2)), now), isFalse);
    expect(pendingPaymentExpired(now.subtract(const Duration(days: 4)), now), isTrue);
  });
}
