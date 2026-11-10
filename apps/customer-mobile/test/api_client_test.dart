import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/api_client.dart';
import 'package:petapp/api/session_store.dart';

import 'fixture.dart';

/// Scripted HTTP: answers by path, records what was sent.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);
  final Future<(int, String)> Function(RequestOptions) handler;
  final calls = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    calls.add(o);
    final (status, json) = await handler(o);
    return ResponseBody.fromString(json, status, headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

String ok(Object data) => jsonEncode({'success': true, 'data': data, 'message': 'Success', 'meta': {}});

void main() {
  test('unwraps the envelope', () async {
    final c = ApiClient(baseUrl: 'http://api', session: SessionStore.memory(), adapter: FakeAdapter((_) async => (200, fixtureRaw('me'))));
    final me = await c.get('/users/me') as Map<String, dynamic>;
    expect(me['name'], 'Aanya Test');
  });

  test('turns API errors into readable exceptions', () async {
    final c = ApiClient(baseUrl: 'http://api', session: SessionStore.memory(), adapter: FakeAdapter((_) async => (400, fixtureRaw('error_validation'))));
    await expectLater(c.post('/pets', {}), throwsA(isA<ApiException>().having((e) => e.status, 'status', 400).having((e) => e.message, 'message', 'Validation failed').having((e) => e.fields, 'fields', isNotEmpty)));
  });

  test('sends the token, except to auth endpoints', () async {
    final session = SessionStore.memory()..accessToken = 'AT1'..refreshToken = 'RT1';
    final fake = FakeAdapter((_) async => (200, ok({})));
    final c = ApiClient(baseUrl: 'http://api', session: session, adapter: fake);
    await c.get('/users/me');
    await c.post('/auth/otp/request', {'phone': '9812345678'});
    expect(fake.calls[0].headers['Authorization'], 'Bearer AT1');
    expect(fake.calls[1].headers.containsKey('Authorization'), isFalse);
  });

  test('parallel 401s trigger exactly one refresh, then every request retries with the new token', () async {
    final session = SessionStore.memory()..accessToken = 'old'..refreshToken = 'RT1';
    var refreshes = 0;
    final fake = FakeAdapter((o) async {
      if (o.path.endsWith('/auth/refresh')) {
        refreshes++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return (200, ok({'accessToken': 'new', 'refreshToken': 'RT2', 'accessTokenExpiresIn': 900, 'refreshTokenExpiresAt': '2030-01-01T00:00:00Z'}));
      }
      return o.headers['Authorization'] == 'Bearer new' ? (200, ok({'path': o.path})) : (401, jsonEncode({'success': false, 'message': 'Your session has expired. Please sign in again.', 'errors': []}));
    });
    final c = ApiClient(baseUrl: 'http://api', session: session, adapter: fake);
    final results = await Future.wait([c.get('/feed'), c.get('/users/me'), c.get('/notifications')]);
    expect(refreshes, 1);
    expect(results.map((r) => (r as Map<String, dynamic>)['path']), ['/feed', '/users/me', '/notifications']);
    expect(session.refreshToken, 'RT2');
  });

  test('a rejected refresh clears the session and reports expiry', () async {
    final session = SessionStore.memory()..accessToken = 'old'..refreshToken = 'revoked';
    var expired = false;
    final fake = FakeAdapter((o) async => (401, jsonEncode({'success': false, 'message': 'Your session has expired. Please sign in again.', 'errors': []})));
    final c = ApiClient(baseUrl: 'http://api', session: session, adapter: fake, onSessionExpired: () => expired = true);
    await expectLater(c.get('/feed'), throwsA(isA<ApiException>().having((e) => e.isUnauthorized, '401', isTrue)));
    expect(expired, isTrue);
    expect(session.hasSession, isFalse);
  });
}
