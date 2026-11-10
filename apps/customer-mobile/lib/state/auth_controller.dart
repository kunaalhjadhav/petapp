import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../services/pending_payments.dart';
import '../services/push_service.dart';
import 'providers.dart';

enum AuthStatus { loading, signedOut, needsName, signedIn }

class AuthState {
  const AuthState(this.status, {this.phone, this.me, this.notice});
  final AuthStatus status;
  final String? phone; // number the code was sent to
  final Me? me;

  /// A one-off message for the next screen: "your account will be deleted on…", "welcome back…".
  final String? notice;
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState(AuthStatus.loading));
  final Ref _ref;

  Future<void> init() async {
    final session = _ref.read(sessionStoreProvider);
    if (!session.hasSession) {
      state = const AuthState(AuthStatus.signedOut);
      return;
    }
    try {
      await _enter(await _ref.read(apiProvider).me());
    } on ApiException catch (e) {
      // Offline at launch: keep the session and show the app; screens will retry.
      if (e.isOffline) {
        state = const AuthState(AuthStatus.signedIn);
      } else {
        await session.clear();
        state = const AuthState(AuthStatus.signedOut);
      }
    }
  }

  Future<void> requestOtp(String phone) async {
    await _ref.read(apiProvider).requestOtp(phone);
    state = AuthState(AuthStatus.signedOut, phone: phone);
  }

  Future<void> verifyOtp(String code) async {
    final phone = state.phone;
    if (phone == null) throw ApiException(400, 'Enter your phone number first.');
    final r = await _ref.read(apiProvider).verifyOtp(phone, code);
    await _ref.read(sessionStoreProvider).save(r.tokens.accessToken, r.tokens.refreshToken);
    await _enter(await _ref.read(apiProvider).me(), notice: r.accountRestored ? 'Welcome back! Your account won’t be deleted.' : null);
  }

  Future<void> saveName(String name) async {
    await _enter(await _ref.read(apiProvider).updateMe(name: name));
  }

  Future<void> _enter(Me me, {String? notice}) async {
    state = AuthState((me.name ?? '').trim().isEmpty ? AuthStatus.needsName : AuthStatus.signedIn, me: me, notice: notice);
    _ref.invalidate(meProvider);
    if (state.status == AuthStatus.signedIn) await _ref.read(pushServiceProvider).start();
  }

  /// Unregister this phone from push first, so the next person signing in here
  /// doesn't receive this account's notifications.
  Future<void> logout() async {
    final api = _ref.read(apiProvider);
    try {
      await _ref.read(pushServiceProvider).stop(api);
      await api.logout();
    } catch (_) {
      // Signing out locally still matters if the network call fails.
    }
    await _ref.read(sessionStoreProvider).clear();
    await _forgetLocalData();
    state = const AuthState(AuthStatus.signedOut);
  }

  /// What the phone kept for this person (screens shown offline, payments waiting to be confirmed): the next person
  /// to sign in must never see it.
  Future<void> _forgetLocalData() async {
    try {
      await _ref.read(offlineCacheProvider).clear();
      await PendingPayments.clear();
    } catch (_) {
      // Best effort; storage errors don't stop signing out.
    }
  }

  Future<void> deleteAccount() async {
    final r = await _ref.read(apiProvider).deleteAccount();
    try {
      await _ref.read(pushServiceProvider).stop(_ref.read(apiProvider));
    } catch (_) {
      // The server already removed this phone's push registration.
    }
    await _ref.read(sessionStoreProvider).clear();
    await _forgetLocalData();
    state = AuthState(AuthStatus.signedOut, notice: deletionNotice(r));
  }

  /// Shown once (the screen that shows it calls this).
  void clearNotice() {
    if (state.notice != null) state = AuthState(state.status, phone: state.phone, me: state.me);
  }

  void sessionExpired() {
    if (state.status != AuthStatus.signedOut) {
      unawaited(_ref.read(offlineCacheProvider).clear().catchError((_) {}));
      state = const AuthState(AuthStatus.signedOut);
    }
  }
}

/// What happens next after asking to delete the account.
String deletionNotice(DeletionScheduled r) {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final d = r.eraseAfter?.toLocal();
  final when = d == null ? 'in ${r.graceDays} days' : 'on ${d.day} ${m[d.month - 1]} ${d.year}';
  return 'Your account will be deleted $when. Changed your mind? Sign in before then to keep it.';
}
