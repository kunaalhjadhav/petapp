import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/offline_logic.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'coupons.dart';
import 'dashboard.dart';
import 'earnings.dart';
import 'money.dart';
import 'onboarding.dart';
import 'orders.dart';
import 'products.dart';
import 'chat/business_chat.dart';
import 'reviews/business_reviews.dart';

/// Signed in: approved stores (and paused ones, which still have parcels to finish) get the workspace;
/// everyone else gets the setup checklist.
class HomeGate extends ConsumerWidget {
  const HomeGate({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(profileProvider).when(
        loading: () => const Scaffold(body: LoadingView()),
        error: (e, _) => Scaffold(body: ErrorView(error: e, onRetry: () => ref.invalidate(profileProvider))),
        data: (p) => p != null && (p.live || p.status == 'SUSPENDED') ? const HomeShell() : OnboardingScreen(profile: p),
      );
}

/// The bottom tab in view. The home screen's shortcuts switch it (e.g. "3 to pack" opens Orders on that filter).
final tabProvider = StateProvider<int>((_) => 0);

class HomeShell extends ConsumerWidget {
  const HomeShell({super.key});
  static const _pages = [DashboardScreen(), OrdersScreen(), ProductsScreen(), EarningsScreen(), StoreScreen()];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tab = ref.watch(tabProvider);
    final todo = ref.watch(dashboardProvider).valueOrNull?.needsAction ?? 0;
    return Scaffold(
      body: Column(children: [const OfflineBanner(), Expanded(child: IndexedStack(index: tab, children: _pages))]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => ref.read(tabProvider.notifier).state = i,
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(
            icon: Badge(isLabelVisible: todo > 0, label: Text('$todo'), child: const Icon(Icons.inventory_2_outlined)),
            selectedIcon: Badge(isLabelVisible: todo > 0, label: Text('$todo'), child: const Icon(Icons.inventory_2)),
            label: 'Orders',
          ),
          const NavigationDestination(icon: Icon(Icons.sell_outlined), selectedIcon: Icon(Icons.sell), label: 'Products'),
          const NavigationDestination(icon: Icon(Icons.currency_rupee_outlined), selectedIcon: Icon(Icons.currency_rupee), label: 'Money'),
          const NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Store'),
        ],
      ),
    );
  }
}

class StoreScreen extends ConsumerWidget {
  const StoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(profileProvider).valueOrNull;
    void open(Widget page) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
    return Scaffold(
      appBar: AppBar(title: Text(p?.businessName ?? 'Store')),
      body: p == null
          ? const LoadingView()
          : ListView(children: [
              ListTile(
                leading: Icon(p.live ? Icons.verified : Icons.pause_circle_outline, color: p.live ? Brand.teal : Brand.heart),
                title: Text(p.live ? 'Approved seller' : 'Store paused'),
                subtitle: Text(p.live
                    ? (p.ratingCount == 0 ? 'No ratings yet' : '★ ${p.ratingAvg.toStringAsFixed(1)} from ${p.ratingCount} rating${p.ratingCount == 1 ? '' : 's'}')
                    : (p.statusReason ?? 'Your products are hidden from shoppers. Finish the parcels you have and contact seller support.')),
              ),
              ListTile(
                leading: const Icon(Icons.account_balance_outlined),
                title: const Text('Payout account'),
                subtitle: const Text('Where your earnings are paid'),
                onTap: () => open(const PayoutAccountScreen()),
              ),
              ListTile(leading: const Icon(Icons.local_offer_outlined), title: const Text('Coupons'), subtitle: const Text('Discounts on your products, funded by you'), onTap: () => open(const CouponsScreen())),
              ListTile(leading: const Icon(Icons.edit_outlined), title: const Text('Store details'), subtitle: Text('${p.addressLine}, ${p.city}'), onTap: () => open(StoreFormScreen(profile: p))),
              ListTile(leading: const Icon(Icons.folder_outlined), title: const Text('Documents'), subtitle: Text('${p.documents.length} on file'), onTap: () => open(const DocumentsScreen())),
              ListTile(
                leading: const Icon(Icons.percent),
                title: const Text('PetApp fee'),
                subtitle: Text(p.commissionBps != null
                    ? '${percent(p.commissionBps!)} of each item’s price (your agreed rate)'
                    : 'Set by product category. Each order shows the fee and what you earn.'),
              ),
              if (p.gstin != null) ListTile(leading: const Icon(Icons.receipt_long_outlined), title: const Text('GSTIN'), subtitle: Text(p.gstin!)),
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
