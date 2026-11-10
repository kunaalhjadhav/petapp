import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/offline_cache.dart';
import '../api/models.dart';
import '../api/session_store.dart';
import '../api/vendor_api.dart';
import '../config.dart';
import '../services/push_service.dart';
import '../services/social_sign_in.dart';

final sessionStoreProvider = Provider<SessionStore>((_) => throw UnimplementedError('override in main'));

/// Last answers of some screens, shown offline (Phase 10b). Overridden in main() with the on-phone cache.
final offlineCacheProvider = Provider<OfflineCache>((_) => MemoryOfflineCache());

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(
      baseUrl: AppConfig.apiBaseUrl,
      session: ref.watch(sessionStoreProvider),
      onSessionExpired: () => ref.read(authProvider.notifier).signedOut(),
      cache: ref.watch(offlineCacheProvider),
    ));

final apiProvider = Provider<VendorApi>((ref) => VendorApi(ref.watch(apiClientProvider)));

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
    _ref.invalidate(productsProvider); // not auto-disposed: never show another account's catalogue
    state = const AuthState(AuthStatus.signedIn);
    unawaited(_ref.read(pushServiceProvider).start());
  }

  /// "Continue with Google" (Android) or "Sign in with Apple" (iPhone), checked by the API with Google or Apple.
  Future<void> socialSignIn(SocialCredential c) async {
    final api = _ref.read(apiProvider);
    final t = switch (c.provider) {
      SocialProvider.google => await api.googleLogin(c.token),
      SocialProvider.apple => await api.appleLogin(c.token, c.nonce!, name: c.name),
    };
    await _ref.read(sessionStoreProvider).save(t.accessToken, t.refreshToken);
    _ref.invalidate(profileProvider);
    _ref.invalidate(productsProvider); // not auto-disposed: never show another account's catalogue
    state = const AuthState(AuthStatus.signedIn);
    unawaited(_ref.read(pushServiceProvider).start());
  }

  Future<void> logout() async {
    await _ref.read(pushServiceProvider).stop();
    try {
      await _ref.read(apiProvider).logout();
    } catch (_) {}
    await _ref.read(sessionStoreProvider).clear();
    await SocialSignIn.signOut();
    // The next person to sign in on this phone must never see this store's saved screens.
    await _ref.read(offlineCacheProvider).clear().catchError((_) {});
    _ref.invalidate(productsProvider);
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

/// The seller's store, or null before setup starts. Screens invalidate it after changes.
final profileProvider = FutureProvider<VendorProfile?>((ref) => ref.watch(apiProvider).profile());
final categoriesProvider = FutureProvider<List<Category>>((ref) => ref.watch(apiProvider).categories());
final dashboardProvider = FutureProvider.autoDispose<Dashboard>((ref) => ref.watch(apiProvider).dashboard());
final productsProvider = FutureProvider<List<Product>>((ref) => ref.watch(apiProvider).products());
final couponsProvider = FutureProvider.autoDispose<List<Coupon>>((ref) => ref.watch(apiProvider).coupons());
final earningsProvider = FutureProvider.autoDispose<Earnings>((ref) => ref.watch(apiProvider).earnings());
final payoutSummaryProvider = FutureProvider.autoDispose<PayoutSummary>((ref) => ref.watch(apiProvider).payouts());
final payoutAccountProvider = FutureProvider.autoDispose<PayoutAccounts>((ref) => ref.watch(apiProvider).payoutAccount());

/// Bumped to make order lists reload (they page themselves, so they watch this instead of being a FutureProvider).
final ordersVersionProvider = StateProvider<int>((_) => 0);

/// After anything that moves an order or stock: the order lists, products, the home screen and money change together.
void refreshSales(WidgetRef ref) {
  ref.invalidate(dashboardProvider);
  ref.invalidate(productsProvider);
  ref.invalidate(earningsProvider);
  ref.invalidate(payoutSummaryProvider);
  ref.read(ordersVersionProvider.notifier).state++;
}
