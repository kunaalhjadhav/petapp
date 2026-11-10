import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'error_messages.dart';
import 'offline_cache.dart';
import 'offline_logic.dart';
import 'session_store.dart';

/// An error the user can read. `message` comes from the API's envelope.
class ApiException implements Exception {
  ApiException(this.status, this.message, [this.fields = const [], this.termsSlug]);
  final int status;
  final String message;
  final List<String> fields;

  /// The legal document (e.g. `contest-terms`) that must be accepted before trying again, when that's what stopped it.
  final String? termsSlug;
  bool get needsTerms => termsSlug != null;

  bool get isUnauthorized => status == 401;
  bool get isNotFound => status == 404;
  bool get isOffline => status == 0;

  @override
  String toString() => message;

  static ApiException from(Object e) {
    if (e is ApiException) return e;
    if (e is DioException) {
      final data = e.response?.data;
      final status = e.response?.statusCode ?? 0;
      if (data is Map && data['message'] is String) {
        final items = (data['errors'] as List?)?.whereType<Map<dynamic, dynamic>>().toList() ?? const <Map<dynamic, dynamic>>[];
        final errors = items.map((x) => '${x['message']}').toList();
        final terms = items.where((x) => x['code'] == 'TERMS_NOT_ACCEPTED' && x['field'] is String).map((x) => x['field'] as String).firstOrNull;
        // Server faults read the same whatever the server said: its internals are never shown (spec §85).
        return ApiException(status, friendlyMessage(status, data['message'] as String), status >= 500 && status != 503 ? const [] : errors, terms);
      }
      if (isConnectionFailure(e)) return ApiException(0, friendlyMessage(0, null));
      return ApiException(status, friendlyMessage(status, null));
    }
    return ApiException(0, 'Something went wrong. Please try again.');
  }
}

/// Unwraps `{ success, data, message, meta }` and keeps the session fresh.
/// The request never got an answer: no network, or it timed out.
bool isConnectionFailure(DioException e) =>
    e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout || e.type == DioExceptionType.sendTimeout;

/// Reads are retried when the connection drops, and some screens' last answers are kept to show offline (Phase 10b).
class ApiClient {
  ApiClient({required String baseUrl, required this.session, HttpClientAdapter? adapter, this.onSessionExpired, this.cache, this.retryDelays = retryDelaysFor})
      : dio = Dio(BaseOptions(
          baseUrl: '$baseUrl/api/v1',
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 30),
          headers: {'Accept': 'application/json'},
        )) {
    if (adapter != null) dio.httpClientAdapter = adapter;
    dio.interceptors.add(_AuthInterceptor(this));
  }

  final Dio dio;
  final SessionStore session;

  /// Called when the refresh token is no longer accepted: the app returns to sign-in.
  final void Function()? onSessionExpired;

  /// Last answers of some screens, shown when there's no connection.
  final OfflineCache? cache;
  final List<Duration> Function(String method) retryDelays;

  /// When the last answer shown came from the phone rather than the server (null: online). The app shows a notice.
  final ValueNotifier<DateTime?> offlineSince = ValueNotifier(null);

  Future<dynamic> get(String path, {Map<String, Object?>? query}) => _send('GET', path, query: query);
  Future<dynamic> post(String path, [Object? body]) => _send('POST', path, body: body ?? const <String, Object?>{});
  Future<dynamic> put(String path, [Object? body]) => _send('PUT', path, body: body);
  Future<dynamic> patch(String path, [Object? body]) => _send('PATCH', path, body: body);
  Future<dynamic> delete(String path) => _send('DELETE', path);

  /// A page of a paged list: the items, and whether another page follows.
  Future<(List<dynamic>, bool)> getPaged(String path, {Map<String, Object?>? query}) async {
    final r = await _send('GET', path, query: query, withMeta: true) as (Object?, Object?);
    final meta = r.$2 is Map ? r.$2! as Map : const {};
    final page = meta['page'] is num ? (meta['page'] as num).toInt() : 1;
    final pages = meta['totalPages'] is num ? (meta['totalPages'] as num).toInt() : 1;
    return (r.$1 is List ? r.$1! as List : const <dynamic>[], page < pages);
  }

  Future<dynamic> _send(String method, String path, {Object? body, Map<String, Object?>? query, bool withMeta = false}) async {
    final q = query == null ? null : (Map<String, Object?>.of(query)..removeWhere((_, v) => v == null));
    final key = method == 'GET' ? cacheKey(path, q) : null;
    final delays = retryDelays(method);
    for (var attempt = 0;; attempt++) {
      try {
        final r = await dio.request<Object?>(path, data: body, queryParameters: q, options: Options(method: method));
        final data = r.data;
        if (data is Map && data['success'] == true) {
          if (offlineSince.value != null) offlineSince.value = null;
          if (key != null && cache != null) {
            await cache!.write(key, jsonEncode({'data': data['data'], 'meta': data['meta'], 'at': DateTime.now().toIso8601String()})).catchError((_) {});
          }
          return withMeta ? (data['data'], data['meta']) : data['data'];
        }
        throw ApiException(r.statusCode ?? 0, 'Unexpected response from the server.');
      } on DioException catch (e) {
        if (isConnectionFailure(e) && attempt < delays.length) {
          await Future<void>.delayed(delays[attempt]);
          continue;
        }
        if (isConnectionFailure(e) && key != null && cache != null) {
          final saved = await _fromCache(key, withMeta);
          if (saved != null) return saved.$1;
        }
        throw ApiException.from(e);
      } catch (e) {
        throw ApiException.from(e);
      }
    }
  }

  /// A saved answer, marked as offline. Null when nothing was saved.
  Future<(Object?,)?> _fromCache(String key, bool withMeta) async {
    final raw = await cache!.read(key).catchError((_) => null);
    if (raw == null) return null;
    final j = jsonDecode(raw) as Map<String, dynamic>;
    offlineSince.value = DateTime.tryParse('${j['at']}') ?? DateTime.now();
    return (withMeta ? (j['data'], j['meta']) : j['data'],);
  }

  // ── refresh (single flight) ──
  Completer<bool>? _refreshing;

  /// Refreshes once even if many requests hit 401 at the same time.
  Future<bool> refresh() async {
    if (_refreshing != null) return _refreshing!.future;
    final c = _refreshing = Completer<bool>();
    try {
      final rt = session.refreshToken;
      if (rt == null) {
        c.complete(false);
      } else {
        // A bare client: the refresh call must not go through the auth interceptor.
        final bare = Dio(BaseOptions(baseUrl: dio.options.baseUrl, connectTimeout: const Duration(seconds: 15)))
          ..httpClientAdapter = dio.httpClientAdapter;
        final res = await bare.post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': rt});
        final t = res.data!['data'] as Map<String, dynamic>;
        await session.save(t['accessToken'] as String, t['refreshToken'] as String);
        c.complete(true);
      }
    } catch (_) {
      c.complete(false);
    } finally {
      _refreshing = null;
    }
    return c.future;
  }
}

class _AuthInterceptor extends QueuedInterceptorsWrapper {
  _AuthInterceptor(this.client);
  final ApiClient client;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final t = client.session.accessToken;
    if (t != null && !options.path.startsWith('/auth/')) options.headers['Authorization'] = 'Bearer $t';
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final req = err.requestOptions;
    final unauthorized = err.response?.statusCode == 401;
    if (!unauthorized || req.path.startsWith('/auth/') || req.extra['retried'] == true || client.session.refreshToken == null) {
      return handler.next(err);
    }
    // Another request may already have refreshed while this one waited in the queue.
    final sentWith = req.headers['Authorization'];
    final current = client.session.accessToken;
    final ok = (current != null && sentWith != 'Bearer $current') ? true : await client.refresh();
    if (!ok) {
      await client.session.clear();
      client.onSessionExpired?.call();
      return handler.next(err);
    }
    try {
      req.headers['Authorization'] = 'Bearer ${client.session.accessToken}';
      req.extra['retried'] = true;
      final res = await client.dio.fetch<Object?>(req);
      handler.resolve(res);
    } on DioException catch (e) {
      handler.next(e);
    }
  }
}
