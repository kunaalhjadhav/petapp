import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/offline_cache.dart';
import '../api/models.dart';
import '../api/petapp_api.dart';
import '../api/session_store.dart';
import '../config.dart';
import '../features/home/place.dart';
import 'auth_controller.dart';
import 'paged_controller.dart';

/// Overridden in main() after the session has been read from secure storage.
final sessionStoreProvider = Provider<SessionStore>((_) => throw UnimplementedError('override in main'));

/// Last answers of some screens, shown offline (Phase 10b). Overridden in main() with the on-phone cache.
final offlineCacheProvider = Provider<OfflineCache>((_) => MemoryOfflineCache());

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(
      baseUrl: AppConfig.apiBaseUrl,
      session: ref.watch(sessionStoreProvider),
      onSessionExpired: () => ref.read(authProvider.notifier).sessionExpired(),
      cache: ref.watch(offlineCacheProvider),
    ));

final apiProvider = Provider<PetAppApi>((ref) => PetAppApi(ref.watch(apiClientProvider)));

final authProvider = StateNotifierProvider<AuthController, AuthState>((ref) => AuthController(ref));

/// Feature switches from the admin dashboard. Defaults to "on" for social if the call fails,
/// because the API itself answers 404 for anything that is switched off.
final flagsProvider = FutureProvider<Map<String, bool>>((ref) async {
  try {
    return await ref.watch(apiProvider).flags();
  } catch (_) {
    return const {'ENABLE_REELS': true};
  }
});

final socialEnabledProvider = Provider<bool>((ref) => ref.watch(flagsProvider).valueOrNull?['ENABLE_REELS'] ?? true);
final shopEnabledProvider = Provider<bool>((ref) => ref.watch(flagsProvider).valueOrNull?['ENABLE_MARKETPLACE'] ?? false);
final contestsEnabledProvider = Provider<bool>((ref) => ref.watch(flagsProvider).valueOrNull?['ENABLE_CONTESTS'] ?? false);
final assistantEnabledProvider = Provider<bool>((ref) => ref.watch(flagsProvider).valueOrNull?['ENABLE_AI_ASSISTANT'] ?? false);
final servicesEnabledProvider = Provider<bool>((ref) => ref.watch(flagsProvider).valueOrNull?['ENABLE_SERVICES'] ?? false);
/// Membership plans (Phase 9d): off unless PetApp switches them on.
final membershipsEnabledProvider = Provider<bool>((ref) => ref.watch(flagsProvider).valueOrNull?['ENABLE_MEMBERSHIPS'] ?? false);

final meProvider = FutureProvider<Me>((ref) => ref.watch(apiProvider).me());

final unreadCountProvider = FutureProvider.autoDispose<int>((ref) async {
  try {
    return await ref.watch(apiProvider).unreadCount();
  } catch (_) {
    return 0;
  }
});

final myPetsProvider = FutureProvider.autoDispose<List<Pet>>((ref) => ref.watch(apiProvider).myPets());
final speciesProvider = FutureProvider<List<Species>>((ref) => ref.watch(apiProvider).species());
final breedsProvider = FutureProvider.family<List<Breed>, String>((ref, speciesId) => ref.watch(apiProvider).breeds(speciesId));

enum FeedKind { following, discover, reels }

final feedProvider = StateNotifierProvider.family<PagedController<Post>, PagedState<Post>, FeedKind>((ref, kind) {
  final api = ref.watch(apiProvider);
  return PagedController<Post>((cursor) => switch (kind) {
        FeedKind.following => api.feed(cursor: cursor),
        FeedKind.discover => api.trending(cursor: cursor),
        FeedKind.reels => api.recommendedReels(cursor: cursor),
      });
});

final userPostsProvider = StateNotifierProvider.autoDispose.family<PagedController<Post>, PagedState<Post>, String>(
    (ref, userId) => PagedController<Post>((c) => ref.watch(apiProvider).userPosts(userId, cursor: c)));

final petPostsProvider = StateNotifierProvider.autoDispose.family<PagedController<Post>, PagedState<Post>, String>(
    (ref, petId) => PagedController<Post>((c) => ref.watch(apiProvider).petPosts(petId, cursor: c)));

final savedPostsProvider = StateNotifierProvider.autoDispose<PagedController<Post>, PagedState<Post>>(
    (ref) => PagedController<Post>((c) => ref.watch(apiProvider).saved(cursor: c)));

final hashtagPostsProvider = StateNotifierProvider.autoDispose.family<PagedController<Post>, PagedState<Post>, String>(
    (ref, tag) => PagedController<Post>((c) => ref.watch(apiProvider).hashtagPosts(tag, cursor: c)));

final commentsProvider = StateNotifierProvider.autoDispose.family<PagedController<Comment>, PagedState<Comment>, String>(
    (ref, postId) => PagedController<Comment>((c) => ref.watch(apiProvider).comments(postId, cursor: c)));

final notificationsProvider = StateNotifierProvider.autoDispose<PagedController<AppNotification>, PagedState<AppNotification>>(
    (ref) => PagedController<AppNotification>((c) async => (await ref.watch(apiProvider).notifications(cursor: c)).page));

/// The home screen for the chosen place; refreshes when the place changes.
final homeProvider = FutureProvider.autoDispose<HomeFeed>((ref) {
  final place = ref.watch(searchPlaceProvider);
  return ref.watch(apiProvider).home(lat: place?.at.lat, lng: place?.at.lng, city: placeCity(place));
});

/// Items marked "Not interested" this session, hidden straight away (the API also stops recommending them).
final dismissedProvider = StateProvider<Set<String>>((_) => const {});

final recoSettingsProvider = FutureProvider.autoDispose<RecoSettings>((ref) => ref.watch(apiProvider).recoSettings());
