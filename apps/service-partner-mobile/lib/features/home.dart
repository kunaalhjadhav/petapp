import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/offline_logic.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'bookings.dart';
import 'earnings.dart';
import 'money.dart';
import 'onboarding.dart';
import 'schedule.dart';
import 'services_screen.dart';
import 'chat/business_chat.dart';
import 'reviews/business_reviews.dart';

/// Signed in: verified partners get the workspace, everyone else the verification checklist.
class HomeGate extends ConsumerWidget {
  const HomeGate({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(profileProvider).when(
        loading: () => const Scaffold(body: LoadingView()),
        error: (e, _) => Scaffold(body: ErrorView(error: e, onRetry: () => ref.invalidate(profileProvider))),
        data: (p) => p != null && p.live ? const HomeShell() : OnboardingScreen(profile: p),
      );
}

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});
  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;
  static const _pages = [BookingsScreen(), ScheduleScreen(), ServicesScreen(), EarningsScreen(), _Business()];

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Column(children: [const OfflineBanner(), Expanded(child: IndexedStack(index: _tab, children: _pages))]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.event_note_outlined), selectedIcon: Icon(Icons.event_note), label: 'Bookings'),
            NavigationDestination(icon: Icon(Icons.schedule_outlined), selectedIcon: Icon(Icons.schedule), label: 'Hours'),
            NavigationDestination(icon: Icon(Icons.content_cut_outlined), selectedIcon: Icon(Icons.content_cut), label: 'Services'),
            NavigationDestination(icon: Icon(Icons.currency_rupee_outlined), selectedIcon: Icon(Icons.currency_rupee), label: 'Money'),
            NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Business'),
          ],
        ),
      );
}

class _Business extends ConsumerWidget {
  const _Business();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(profileProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(p?.businessName ?? 'Business')),
      body: p == null
          ? const LoadingView()
          : ListView(children: [
              ListTile(
                leading: const Icon(Icons.verified, color: Brand.teal),
                title: const Text('Verified partner'),
                subtitle: Text(p.ratingCount == 0 ? 'No reviews yet' : '★ ${p.ratingAvg.toStringAsFixed(1)} from ${p.ratingCount} review${p.ratingCount == 1 ? '' : 's'}'),
              ),
              ListTile(
                leading: const Icon(Icons.edit_outlined),
                title: const Text('Business details'),
                subtitle: Text('${p.addressLine}, ${p.city}'),
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ProfileFormScreen(profile: p))),
              ),
              ListTile(
                leading: const Icon(Icons.folder_outlined),
                title: const Text('Documents'),
                subtitle: Text('${p.documents.length} on file'),
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const DocumentsScreen())),
              ),
              ListTile(
                leading: const Icon(Icons.account_balance_outlined),
                title: const Text('Payout account'),
                subtitle: const Text('Where your earnings are paid'),
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const PayoutAccountScreen())),
              ),
              ListTile(
                leading: const Icon(Icons.percent),
                title: const Text('PetApp fee'),
                subtitle: Text(p.commissionBps != null
                    ? '${percent(p.commissionBps!)} of each completed booking (your agreed rate)'
                    : p.services.isEmpty
                        ? 'Set by category; shown on each service'
                        : {for (final s in p.services) s.categoryName: percent(s.categoryCommissionBps)}.entries.map((e) => '${e.key} ${e.value}').join(' · ')),
              ),
              const Divider(),
              const ReviewsTile(),
              const ChatAndHelpTiles(),
              const Divider(),
              ListTile(leading: const Icon(Icons.logout), title: const Text('Sign out'), onTap: () => ref.read(authProvider.notifier).logout()),
            ]),
    );
  }
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
