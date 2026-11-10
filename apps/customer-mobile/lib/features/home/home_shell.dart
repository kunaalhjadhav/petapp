import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/offline_logic.dart';
import '../../common/widgets.dart';
import '../../services/pending_payments.dart';
import '../../state/providers.dart';
import '../privacy/privacy_screens.dart';

/// Bottom navigation. Tabs keep their state (scroll position, loaded pages).
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key, required this.shell});
  final StatefulNavigationShell shell;
  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> with WidgetsBindingObserver {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Keep the badge fresh while the app is open; push covers the rest.
    _poll = Timer.periodic(const Duration(minutes: 1), (_) => ref.invalidate(unreadCountProvider));
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      // "Welcome back, your account won't be deleted", once.
      final notice = ref.read(authProvider).notice;
      if (notice != null) {
        showMessage(context, notice);
        ref.read(authProvider.notifier).clearNotice();
      }
      // New or updated terms everyone must accept.
      await checkPendingTerms(context, ref);
      await _confirmPendingPayments();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(unreadCountProvider);
      unawaited(_confirmPendingPayments());
    }
  }

  /// Payments the gateway took while the API couldn't be reached are confirmed as soon as it can (spec §85).
  Future<void> _confirmPendingPayments() async {
    try {
      final n = await PendingPayments.retry(ref.read(apiProvider));
      if (n > 0 && mounted) {
        showMessage(context, n == 1 ? 'Your payment is confirmed.' : '$n payments are confirmed.');
        ref.invalidate(meProvider);
      }
    } catch (_) {
      // Tried again on the next start or resume.
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final unread = ref.watch(unreadCountProvider).valueOrNull ?? 0;
    final social = ref.watch(socialEnabledProvider);
    return Scaffold(
      body: Column(children: [
        const OfflineBanner(),
        Expanded(child: widget.shell),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: widget.shell.currentIndex,
        onDestinationSelected: (i) => widget.shell.goBranch(i, initialLocation: i == widget.shell.currentIndex),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
          NavigationDestination(icon: const Icon(Icons.play_circle_outline), selectedIcon: const Icon(Icons.play_circle_rounded), label: 'Reels', enabled: social),
          NavigationDestination(icon: const Icon(Icons.add_box_outlined), selectedIcon: const Icon(Icons.add_box_rounded), label: 'Create', enabled: social),
          NavigationDestination(
            icon: Badge(isLabelVisible: unread > 0, label: Text(unread > 99 ? '99+' : '$unread'), child: const Icon(Icons.notifications_none_rounded)),
            selectedIcon: const Icon(Icons.notifications_rounded),
            label: 'Alerts',
          ),
          const NavigationDestination(icon: Icon(Icons.person_outline_rounded), selectedIcon: Icon(Icons.person_rounded), label: 'Me'),
        ],
      ),
    );
  }
}

/// Shown when a tab's feature is switched off in the admin dashboard.
class ComingSoon extends StatelessWidget {
  const ComingSoon({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(body: EmptyView(title: 'Coming soon', message: 'This part of PetApp isn’t available yet.'));
}

/// "You're offline · showing what was saved 5 min ago", while screens show saved answers (spec §84).
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final since = ref.watch(apiClientProvider).offlineSince;
    return ValueListenableBuilder<DateTime?>(
      valueListenable: since,
      builder: (context, at, _) {
        if (at == null) return const SizedBox.shrink();
        final scheme = Theme.of(context).colorScheme;
        return Material(
          color: scheme.secondaryContainer,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(children: [
                Icon(Icons.cloud_off_rounded, size: 18, color: scheme.onSecondaryContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('You’re offline · showing what was saved ${savedAgo(at, DateTime.now())}',
                      style: TextStyle(color: scheme.onSecondaryContainer)),
                ),
              ]),
            ),
          ),
        );
      },
    );
  }
}
