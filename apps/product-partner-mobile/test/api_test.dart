import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_seller/api/api_client.dart';
import 'package:petapp_seller/api/session_store.dart';
import 'package:petapp_seller/api/vendor_api.dart';

/// Scripted HTTP: answers by path, records what was sent.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);
  final (int, String) Function(RequestOptions) handler;
  final calls = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    calls.add(o);
    final (status, json) = handler(o);
    return ResponseBody.fromString(json, status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

String raw(String name) => File('test/fixtures/$name.json').readAsStringSync();

void main() {
  VendorApi api(FakeAdapter fake) => VendorApi(ApiClient(baseUrl: 'http://api', session: SessionStore.memory()..accessToken = 'AT'..refreshToken = 'RT', adapter: fake));

  test('order lists page through the API and know when there is more', () async {
    final fake = FakeAdapter((o) {
      final page = o.queryParameters['page'];
      final body = jsonDecode(raw('vendor_orders_to_pack')) as Map<String, dynamic>;
      body['meta'] = {'page': page, 'limit': 30, 'total': 31, 'totalPages': 2};
      return (200, jsonEncode(body));
    });
    final (first, more) = await api(fake).orders(status: 'CONFIRMED');
    expect(first, hasLength(3));
    expect(more, isTrue);
    final (_, more2) = await api(fake).orders(status: 'CONFIRMED', page: 2);
    expect(more2, isFalse);
    expect(fake.calls.first.path, '/vendor/orders');
    expect(fake.calls.first.queryParameters, {'status': 'CONFIRMED', 'page': 1, 'limit': 30});
    // "All" sends no status at all, rather than an empty one.
    await api(fake).orders();
    expect(fake.calls.last.queryParameters.containsKey('status'), isFalse);
  });

  test('a refused submit shows what is still missing', () async {
    final fake = FakeAdapter((_) => (400, raw('vendor_submit_refused')));
    await expectLater(
      api(fake).submit(),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', 'A few things are still missing.').having((e) => e.fields, 'fields', ['Upload your GST certificate.'])),
    );
  });

  test('no store yet comes back as null', () async {
    expect(await api(FakeAdapter((_) => (200, raw('vendor_profile_none')))).profile(), isNull);
  });

  test('stock goes to its own endpoint; a return decision only sends a note when there is one', () async {
    final fake = FakeAdapter((o) => (200, o.path.contains('/stock') ? raw('vendor_stock') : raw('vendor_return_approved')));
    final s = await api(fake).setStock('v1', 30);
    expect(s.stock, 30);
    final call = fake.calls.last;
    expect((call.method, call.path), ('PUT', '/vendor/variants/v1/stock'));
    expect(call.data, {'stock': 30});
    await api(fake).decideReturn('r1', 'APPROVE');
    expect(fake.calls.last.data, {'decision': 'APPROVE'});
    await api(fake).decideReturn('r1', 'REJECT', note: 'Seal broken');
    expect(fake.calls.last.data, {'decision': 'REJECT', 'note': 'Seal broken'});
  });
}
