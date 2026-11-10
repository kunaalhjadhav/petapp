import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/petapp_api.dart';
import '../config.dart';
import '../state/providers.dart';

final pushServiceProvider = Provider<PushService>((ref) => PushService(ref));

/// Opened-from-push targets, consumed by the router (type, id).
final pushTapProvider = StateProvider<({String entityType, String entityId, String? link})?>((_) => null);

/// Firebase push. Does nothing unless Firebase options are passed with --dart-define
/// (see README), so the app runs fine without a Firebase project.
class PushService {
  PushService(this._ref);
  final Ref _ref;
  String? _token;
  StreamSubscription<String>? _refreshSub;
  bool _initialised = false;

  Future<void> start() async {
    if (!AppConfig.pushEnabled) return;
    try {
      if (!_initialised) {
        await Firebase.initializeApp(
          options: const FirebaseOptions(
            apiKey: AppConfig.firebaseApiKey,
            appId: AppConfig.firebaseAppId,
            messagingSenderId: AppConfig.firebaseSenderId,
            projectId: AppConfig.firebaseProjectId,
          ),
        );
        _initialised = true;
        FirebaseMessaging.onMessageOpenedApp.listen(_open);
        final initial = await FirebaseMessaging.instance.getInitialMessage();
        if (initial != null) _open(initial);
      }
      final perm = await FirebaseMessaging.instance.requestPermission();
      if (perm.authorizationStatus == AuthorizationStatus.denied) return;
      _token = await FirebaseMessaging.instance.getToken();
      if (_token != null) await _register(_token!);
      await _refreshSub?.cancel();
      _refreshSub = FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        _token = t;
        unawaited(_register(t));
      });
    } catch (_) {
      // Push is a nice-to-have; never block sign-in on it.
    }
  }

  Future<void> stop(PetAppApi api) async {
    await _refreshSub?.cancel();
    _refreshSub = null;
    final t = _token;
    _token = null;
    if (t != null) await api.removeDevice(t);
  }

  Future<void> _register(String token) => _ref.read(apiProvider).registerDevice(token, Platform.isIOS ? 'IOS' : 'ANDROID');

  void _open(RemoteMessage m) {
    final type = m.data['entityType'];
    final id = m.data['entityId'];
    if (type is String && id is String && id.isNotEmpty) {
      final link = m.data['link'];
      _ref.read(pushTapProvider.notifier).state = (entityType: type, entityId: id, link: link is String && link.isNotEmpty ? link : null);
    }
  }
}
