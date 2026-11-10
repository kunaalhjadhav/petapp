import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';
import '../state/providers.dart';

final pushServiceProvider = Provider<PushService>((ref) => PushService(ref));

/// What a tapped notification is about (type, id), consumed by the chat lifecycle widget.
final pushTapProvider = StateProvider<({String entityType, String entityId})?>((_) => null);

/// Firebase push (the same file in the partner and seller apps). Does nothing unless Firebase options are passed
/// with --dart-define, so the app runs without a Firebase project.
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

  /// Unregister this phone before signing out, so the next person here doesn't get this account's messages.
  Future<void> stop() async {
    await _refreshSub?.cancel();
    _refreshSub = null;
    final t = _token;
    _token = null;
    if (t != null) {
      try {
        await _ref.read(apiProvider).removeDevice(t);
      } catch (_) {
        // Signing out still matters if this fails.
      }
    }
  }

  Future<void> _register(String token) => _ref.read(apiProvider).registerDevice(token, Platform.isIOS ? 'IOS' : 'ANDROID');

  void _open(RemoteMessage m) {
    // Pushes for the customer app (the same person may use both) open nothing here.
    final app = m.data['app'];
    if (app is String && app != AppConfig.chatInbox) return;
    final type = m.data['entityType'];
    final id = m.data['entityId'];
    if (type is String && id is String && id.isNotEmpty) _ref.read(pushTapProvider.notifier).state = (entityType: type, entityId: id);
  }
}
