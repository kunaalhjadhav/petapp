import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'coupons.dart';
import 'home.dart';
import 'orders.dart';
import 'products.dart';
import 'chat/business_chat.dart';

/// What needs doing now, stock to top up, and how sales are going.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(dashboardProvider);
    return Scaffold(
      appBar: AppBar(title: Text(async.valueOrNull?.storeName ?? 'Home'), actions: const [MessagesButton()]),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(dashboardProvider)),
        data: (d) => RefreshIndicator(
          onRefresh: () async => refreshSales(ref),
          child: ListView(padding: const EdgeInsets.all(16), children: [
            if (d.storeStatus == 'SUSPENDED')
              _Banner(
                color: Brand.heart,
                title: 'Store paused',
                text: d.storeStatusReason ?? 'Your products are hidden from shoppers. Finish the parcels you have and contact seller support.',
              ),
            Text('To do', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Row(children: [
              _Todo(label: 'To pack', count: d.toPack, onTap: () => _openOrders(ref, 'CONFIRMED')),
              _Todo(label: 'To ship', count: d.toShip, onTap: () => _openOrders(ref, 'PACKED')),
              _Todo(label: 'In transit', count: d.inTransit, onTap: () => _openOrders(ref, 'SHIPPED'), quiet: true),
              _Todo(label: 'Returns', count: d.returnsToReview, onTap: () => _openOrders(ref, 'RETURN_REQUESTED')),
            ]),
            const SizedBox(height: 24),
            Text('Sales', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            const Text('Paid orders, before cancellations and returns. Your earnings are after PetApp’s fee.', style: TextStyle(color: Brand.muted, fontSize: 12)),
            const SizedBox(height: 8),
            Row(children: [
              _Sales(label: 'Today', w: d.today),
              _Sales(label: 'Last 7 days', w: d.last7Days),
              _Sales(label: 'Last 30 days', w: d.last30Days),
            ]),
            const SizedBox(height: 24),
            Row(children: [
              Expanded(child: Text('Stock alerts', style: Theme.of(context).textTheme.titleMedium)),
              Text('${d.lowStockThreshold} or fewer left', style: const TextStyle(color: Brand.muted, fontSize: 12)),
            ]),
            if (d.stockAlerts.isEmpty)
              const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Everything on sale is well stocked.', style: TextStyle(color: Brand.muted)))
            else
              for (final a in d.stockAlerts)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(a.stock <= 0 ? Icons.remove_shopping_cart_outlined : Icons.warning_amber_rounded, color: a.stock <= 0 ? Brand.heart : const Color(0xFFB7791F)),
                  title: Text('${a.productTitle} · ${a.variantTitle}'),
                  subtitle: Text(a.stock <= 0 ? 'Out of stock · ${a.sku}' : 'Only ${a.stock} left · ${a.sku}'),
                  trailing: TextButton(onPressed: () => editStock(context, ref, variantId: a.variantId, label: '${a.productTitle} · ${a.variantTitle}', current: a.stock), child: const Text('Restock')),
                ),
            const SizedBox(height: 16),
            Text('Products', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final e in d.productsByStatus.entries) Chip(label: Text('${productStatusLabel(e.key)}: ${e.value}')),
              if (d.productsByStatus.isEmpty) const Text('No products yet. Add your first one from the Products tab.', style: TextStyle(color: Brand.muted)),
            ]),
            const SizedBox(height: 16),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.local_offer_outlined),
              title: const Text('Coupons'),
              subtitle: const Text('Run a discount on your products'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const CouponsScreen())),
            ),
          ]),
        ),
      ),
    );
  }

  void _openOrders(WidgetRef ref, String status) {
    ref.read(orderFilterProvider.notifier).state = status;
    ref.read(tabProvider.notifier).state = 1;
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.color, required this.title, required this.text});
  final Color color;
  final String title;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: color.withAlpha(20), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: color)),
          const SizedBox(height: 4),
          Text(text),
        ]),
      );
}

class _Todo extends StatelessWidget {
  const _Todo({required this.label, required this.count, required this.onTap, this.quiet = false});
  final String label;
  final int count;
  final VoidCallback onTap;
  final bool quiet;
  @override
  Widget build(BuildContext context) {
    final hot = count > 0 && !quiet;
    return Expanded(
      child: Card(
        elevation: 0,
        color: hot ? const Color(0xFFDCEBE8) : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Brand.line)),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
            child: Column(children: [
              Text('$count', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: hot ? Brand.teal : Brand.ink)),
              const SizedBox(height: 2),
              Text(label, style: const TextStyle(fontSize: 12, color: Brand.muted), textAlign: TextAlign.center),
            ]),
          ),
        ),
      ),
    );
  }
}

class _Sales extends StatelessWidget {
  const _Sales({required this.label, required this.w});
  final String label;
  final SalesWindow w;
  @override
  Widget build(BuildContext context) => Expanded(
        child: Card(
          elevation: 0,
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Brand.line)),
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: const TextStyle(fontSize: 12, color: Brand.muted)),
              const SizedBox(height: 4),
              Text(rupees(w.salesPaise), style: const TextStyle(fontWeight: FontWeight.w700)),
              Text('${w.orders} order${w.orders == 1 ? '' : 's'}', style: const TextStyle(fontSize: 12)),
              Text('You earn ${rupees(w.earningsPaise)}', style: const TextStyle(fontSize: 12, color: Brand.teal)),
            ]),
          ),
        ),
      );
}
