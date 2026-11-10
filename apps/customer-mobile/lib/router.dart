import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/assistant/assistant_screens.dart';
import 'features/auth/auth_screens.dart';
import 'features/challenges/challenge_screens.dart';
import 'features/chat/chat_screens.dart';
import 'features/support/support_screens.dart';
import 'features/contests/contest_screens.dart';
import 'features/money/money_screens.dart';
import 'features/contests/judge_screens.dart';
import 'features/create/create_screen.dart';
import 'features/home/feed_screen.dart';
import 'features/home/home_screen.dart';
import 'features/home/search_screen.dart';
import 'features/discover/discover_screen.dart';
import 'features/shop/shop_screens.dart';
import 'features/home/home_shell.dart';
import 'features/membership/membership_screen.dart';
import 'features/notifications/notifications_screen.dart';
import 'features/pets/pet_screens.dart';
import 'features/posts/post_screen.dart';
import 'features/privacy/privacy_screens.dart';
import 'features/profile/profile_screens.dart';
import 'features/reels/reels_screen.dart';
import 'features/services/services_screens.dart';
import 'services/deep_links.dart';
import 'services/push_service.dart';
import 'state/auth_controller.dart';
import 'state/providers.dart';

/// Bridges Riverpod auth state to go_router's refreshListenable.
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen<AuthState>(authProvider, (_, __) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final router = GoRouter(
    initialLocation: '/home',
    refreshListenable: _AuthListenable(ref),
    redirect: (context, state) {
      final status = ref.read(authProvider).status;
      final loc = state.matchedLocation;
      final inAuth = loc == '/login' || loc == '/otp';
      // Policies can be read before signing in (linked from the sign-in screen).
      if (loc.startsWith('/legal/') && status != AuthStatus.loading) return null;
      return switch (status) {
        AuthStatus.loading => loc == '/splash' ? null : '/splash',
        AuthStatus.signedOut => inAuth ? null : '/login',
        AuthStatus.needsName => loc == '/name' ? null : '/name',
        AuthStatus.signedIn => (inAuth || loc == '/name' || loc == '/splash') ? '/home' : null,
      };
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
      GoRoute(path: '/login', builder: (_, __) => const PhoneScreen()),
      GoRoute(path: '/otp', builder: (_, __) => const OtpScreen()),
      GoRoute(path: '/name', builder: (_, __) => const NameScreen()),
      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, __) => const HomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/reels', builder: (_, __) => const _Gated(child: ReelsScreen()))]),
          StatefulShellBranch(routes: [GoRoute(path: '/create', builder: (_, __) => const _Gated(child: CreateScreen()))]),
          StatefulShellBranch(routes: [GoRoute(path: '/alerts', builder: (_, __) => const NotificationsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/me', builder: (_, __) => const MeScreen())]),
        ],
      ),
      // Detail screens. Also the targets of petapp:// links and push taps.
      GoRoute(path: '/post/:id', builder: (_, s) => PostScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/p/:id', redirect: (_, s) => '/post/${s.pathParameters['id']}'),
      GoRoute(path: '/reel/:id', redirect: (_, s) => '/post/${s.pathParameters['id']}'),
      GoRoute(path: '/service/:id', redirect: (_, s) => '/service-partner/${s.pathParameters['id']}'),
      GoRoute(path: '/pet/:id', builder: (_, s) => PetScreen(idOrHandle: s.pathParameters['id']!)),
      GoRoute(path: '/pets/new', builder: (_, __) => const PetFormScreen()),
      GoRoute(path: '/user/:id', builder: (_, s) => UserScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/hashtag/:tag', builder: (_, s) => HashtagScreen(tag: s.pathParameters['tag']!)),
      GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
      GoRoute(path: '/membership', builder: (_, __) => const MembershipScreen()),
      GoRoute(path: '/settings/phone', builder: (_, __) => const AddPhoneScreen()),
      GoRoute(path: '/settings/privacy', builder: (_, __) => const PrivacyScreen()),
      GoRoute(path: '/legal/:slug', builder: (_, s) => LegalDocScreen(slug: s.pathParameters['slug']!)),
      GoRoute(path: '/money', builder: (_, __) => const MoneyScreen()),
      GoRoute(path: '/money/invoices', builder: (_, __) => const InvoicesScreen()),
      GoRoute(path: '/money/prizes', builder: (_, __) => const PrizeMoneyScreen()),
      GoRoute(path: '/money/account', builder: (_, __) => const PayoutAccountScreen()),
      GoRoute(path: '/search', builder: (_, s) => SearchScreen(initialQuery: s.uri.queryParameters['q'])),
      GoRoute(path: '/discover', builder: (_, __) => const DiscoverScreen()),
      GoRoute(path: '/assistant', builder: (_, __) => const AssistantScreen()),
      GoRoute(path: '/assistant/history', builder: (_, __) => const AssistantHistoryScreen()),
      GoRoute(path: '/assistant/:id', builder: (_, s) => AssistantScreen(conversationId: s.pathParameters['id'])),
      GoRoute(path: '/shop', builder: (_, s) => ShopScreen(vendorId: s.uri.queryParameters['vendor'], vendorName: s.uri.queryParameters['name'])),
      GoRoute(path: '/product/:id', builder: (_, s) => ProductScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/cart', builder: (_, __) => const CartScreen()),
      GoRoute(path: '/orders', builder: (_, __) => const OrdersScreen()),
      GoRoute(path: '/order/:id', builder: (_, s) => OrderScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/contests', builder: (_, __) => const ContestsScreen()),
      GoRoute(path: '/challenges', builder: (_, __) => const ChallengesScreen()),
      GoRoute(path: '/challenge/:id', builder: (_, s) => ChallengeScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/judging', builder: (_, __) => const JudgeHomeScreen()),
      GoRoute(path: '/services', builder: (_, __) => const ServicesScreen()),
      GoRoute(path: '/service-partner/:id', builder: (_, s) => ServicePartnerScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/my-bookings', builder: (_, __) => const MyBookingsScreen()),
      GoRoute(path: '/booking/:id', builder: (_, s) => BookingScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/contest/:id', builder: (_, s) => ContestScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/contest/:id/leaderboard', builder: (_, s) => LeaderboardScreen(contestId: s.pathParameters['id']!)),
      // Chat and support (Phase 9a)
      GoRoute(path: '/messages', builder: (_, __) => const MessagesScreen()),
      GoRoute(
        path: '/messages/:id',
        builder: (_, s) => ConversationScreen(id: s.pathParameters['id']!, offerRefType: s.uri.queryParameters['ref'], offerRefId: s.uri.queryParameters['refId']),
      ),
      GoRoute(path: '/help', builder: (_, __) => const HelpScreen()),
      GoRoute(
        path: '/help/new',
        builder: (_, s) => NewTicketScreen(refType: s.uri.queryParameters['ref'], refId: s.uri.queryParameters['refId'], refLabel: s.uri.queryParameters['label']),
      ),
      GoRoute(path: '/help/tickets', builder: (_, __) => const TicketsScreen()),
      GoRoute(path: '/help/tickets/:id', builder: (_, s) => TicketScreen(id: s.pathParameters['id']!)),
    ],
    errorBuilder: (_, __) => const Scaffold(body: Center(child: Text('Page not found'))),
  );

  // Opening a push notification navigates to its target.
  ref.listen(pushTapProvider, (_, tap) {
    if (tap == null) return;
    final to = notificationTarget(tap.entityType, tap.entityId, tap.link);
    if (to != null) router.push(to);
    ref.read(pushTapProvider.notifier).state = null;
  });
  // petapp:// and https links from other apps (see services/deep_links.dart).
  ref.read(deepLinksProvider).start(router);
  return router;
});

class _Gated extends ConsumerWidget {
  const _Gated({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(socialEnabledProvider) ? child : const ComingSoon();
}
