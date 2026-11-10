import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_seller/api/api_client.dart';
import 'package:petapp_seller/api/offline_cache.dart';
import 'package:petapp_seller/api/offline_logic.dart';
import 'package:petapp_seller/api/session_store.dart';

String raw(String name) => File('test/fixtures/$name.json').readAsStringSync();

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

/// Offline handling (Phase 10b, spec §84), against responses recorded from the real API.
/// scripts/check_offline_mirrors.py runs the same rules in Python.
void main() {
  test('which reads are kept for offline', () {
    expect(cacheKey('/vendor/orders', {'status': 'TO_PACK', 'page': 1}), '/vendor/orders?page=1&status=TO_PACK');
    expect(cacheKey('/users/me', null), '/users/me');
    expect(cacheKey('/vendor/earnings', null), isNull, reason: 'money is never kept');
    expect(cacheKey('/chat/conversations', null), isNull);
  });

  test('a dropped read is tried again; a write is not', () async {
    final a = FlakyAdapter([null, (200, raw('vendor_orders_to_pack'))]);
    expect(await client(a).get('/vendor/orders', query: {'status': 'TO_PACK', 'page': 1}), isNotNull);
    expect(a.calls, hasLength(2));
    final w = FlakyAdapter([null]);
    await expectLater(client(w).post('/chat/conversations', {}), throwsA(isA<ApiException>().having((e) => e.isOffline, 'offline', isTrue)));
    expect(w.calls, hasLength(1));
  });

  test('offline, the saved answer is shown and marked; back online clears the notice', () async {
    final c = client(FlakyAdapter([(200, raw('vendor_orders_to_pack')), null, null, null, (200, raw('vendor_orders_to_pack'))]), cache: MemoryOfflineCache());
    final first = await c.get('/vendor/orders', query: {'status': 'TO_PACK', 'page': 1});
    expect(await c.get('/vendor/orders', query: {'status': 'TO_PACK', 'page': 1}), first);
    expect(c.offlineSince.value, isNotNull);
    await c.get('/vendor/orders', query: {'status': 'TO_PACK', 'page': 1});
    expect(c.offlineSince.value, isNull);
  });

  test('nothing saved: the offline message', () async {
    final c = client(FlakyAdapter([null, null, null]), cache: MemoryOfflineCache());
    await expectLater(c.get('/vendor/orders', query: {'status': 'TO_PACK', 'page': 1}), throwsA(isA<ApiException>().having((e) => e.message, 'message', startsWith('No internet'))));
  });
}
