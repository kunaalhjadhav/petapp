import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/offline_cache.dart';
import '../api/models.dart';
import '../api/partner_api.dart';
import '../api/session_store.dart';
import '../config.dart';
import '../services/push_service.dart';

final sessionStoreProvider = Provider<SessionStore>((_) => throw UnimplementedError('override in main'));

/// Last answers of some screens, shown offline (Phase 10b). Overridden in main() with the on-phone cache.
final offlineCacheProvider = Provider<OfflineCache>((_) => MemoryOfflineCache());

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(
      baseUrl: AppConfig.apiBaseUrl,
      session: ref.watch(sessionStoreProvider),
      onSessionExpired: () => ref.read(authProvider.notifier).signedOut(),
      cache: ref.watch(offlineCacheProvider),
    ));

final apiProvider = Provider<PartnerApi>((ref) => PartnerApi(ref.watch(apiClientProvider)));

enum AuthStatus { loading, signedOut, signedIn }

class AuthState {
  const AuthState(this.status, {this.phone});
  final AuthStatus status;
  final String? phone;
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref) : super(const AuthState(AuthStatus.loading));
  final Ref _ref;

  Future<void> init() async {
    final s = _ref.read(sessionStoreProvider);
    if (!s.hasSession) {
      state = const AuthState(AuthStatus.signedOut);
      return;
    }
    try {
      await _ref.read(apiProvider).me();
      state = const AuthState(AuthStatus.signedIn);
      unawaited(_ref.read(pushServiceProvider).start());
    } on ApiException catch (e) {
      if (e.isOffline) {
        state = const AuthState(AuthStatus.signedIn);
      } else {
        await s.clear();
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
    final t = await _ref.read(apiProvider).verifyOtp(phone, code);
    await _ref.read(sessionStoreProvider).save(t.accessToken, t.refreshToken);
    _ref.invalidate(profileProvider);
    state = const AuthState(AuthStatus.signedIn);
    unawaited(_ref.read(pushServiceProvider).start());
  }

  Future<void> logout() async {
    await _ref.read(pushServiceProvider).stop();
    try {
      await _ref.read(apiProvider).logout();
    } catch (_) {}
    await _ref.read(sessionStoreProvider).clear();
    // The next person to sign in on this phone must never see this business's saved screens.
    await _ref.read(offlineCacheProvider).clear().catchError((_) {});
    state = const AuthState(AuthStatus.signedOut);
  }

  void signedOut() {
    if (state.status != AuthStatus.signedOut) {
      unawaited(_ref.read(offlineCacheProvider).clear().catchError((_) {}));
      state = const AuthState(AuthStatus.signedOut);
    }
  }
}

final authProvider = StateNotifierProvider<AuthController, AuthState>((ref) => AuthController(ref));

/// The partner profile, or null before onboarding starts. Screens call [refreshProfile] after changes.
final profileProvider = FutureProvider<PartnerProfile?>((ref) => ref.watch(apiProvider).profile());
final categoriesProvider = FutureProvider<List<Category>>((ref) => ref.watch(apiProvider).categories());
final earningsProvider = FutureProvider.autoDispose<Earnings>((ref) => ref.watch(apiProvider).earnings());
final payoutSummaryProvider = FutureProvider.autoDispose<PayoutSummary>((ref) => ref.watch(apiProvider).payouts());
final payoutAccountProvider = FutureProvider.autoDispose<PayoutAccounts>((ref) => ref.watch(apiProvider).payoutAccount());
final bookingsProvider = FutureProvider.autoDispose.family<List<Booking>, String>((ref, when) => ref.watch(apiProvider).bookings(when: when));
