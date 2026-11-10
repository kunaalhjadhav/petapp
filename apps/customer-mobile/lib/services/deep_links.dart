import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../config_share.dart';
import '../state/auth_controller.dart';
import '../state/providers.dart';

/// Where a link opens in the app, or null if it isn't one of ours.
///
/// Accepts the spec's links (petapp://pet/{id}, petapp://reel/{id}, …), the website's https links on our own domain
/// (https://<site>/pet/bruno), and the older petapp://app/post/{id} form.
String? routeForLink(Uri uri, {required Set<String> webHosts, String scheme = appLinkScheme}) {
  final List<String> parts;
  if (uri.scheme == scheme) {
    // petapp://pet/123 has "pet" as its host; petapp://app/post/123 is the older form.
    parts = [if (uri.host.isNotEmpty && uri.host != 'app') uri.host, ...uri.pathSegments];
  } else if ((uri.scheme == 'https' || uri.scheme == 'http') && webHosts.contains(uri.host.toLowerCase())) {
    parts = uri.pathSegments;
  } else {
    return null;
  }
  final segs = parts.where((s) => s.isNotEmpty).toList();
  if (segs.length != 2) return null;
  final key = Uri.encodeComponent(segs[1]);
  return switch (segs[0]) {
    'pet' => '/pet/$key',
    'reel' || 'post' || 'p' => '/post/$key',
    'contest' => '/contest/$key',
    'challenge' => '/challenge/$key',
    'product' => '/product/$key',
    'service' || 'service-partner' => '/service-partner/$key',
    'booking' => '/booking/$key',
    'user' => '/user/$key',
    'hashtag' => '/hashtag/$key',
    'legal' => '/legal/$key',
    _ => null,
  };
}

/// The website's host(s), from SHARE_BASE_URL (with and without "www.").
Set<String> webHostsFor(String baseUrl) {
  final host = Uri.tryParse(baseUrl)?.host.toLowerCase() ?? '';
  if (host.isEmpty) return {};
  final bare = host.startsWith('www.') ? host.substring(4) : host;
  return {bare, 'www.$bare'};
}

/// Opens incoming links. A link that arrives before sign-in is kept and opened once the person is signed in.
class DeepLinks {
  DeepLinks(this._ref);
  final Ref _ref;
  StreamSubscription<Uri>? _sub;
  String? _pending;

  Future<void> start(GoRouter router) async {
    final links = AppLinks();
    final hosts = webHostsFor(shareBaseUrl);
    void open(Uri uri) {
      final route = routeForLink(uri, webHosts: hosts);
      if (route == null) return;
      final signedIn = _ref.read(authProvider).status == AuthStatus.signedIn;
      if (signedIn || route.startsWith('/legal/')) {
        router.push(route);
      } else {
        _pending = route;
      }
    }

    _ref.listen<AuthState>(authProvider, (_, next) {
      if (next.status == AuthStatus.signedIn && _pending != null) {
        final route = _pending!;
        _pending = null;
        // After the home screen has been built.
        scheduleMicrotask(() => router.push(route));
      }
    });
    _sub = links.uriLinkStream.listen(open, onError: (_) {});
    try {
      final initial = await links.getInitialLink();
      if (initial != null) open(initial);
    } catch (_) {
      // No initial link (or the platform doesn't support one).
    }
  }

  void dispose() => _sub?.cancel();
}

final deepLinksProvider = Provider<DeepLinks>((ref) {
  final d = DeepLinks(ref);
  ref.onDispose(d.dispose);
  return d;
});
