import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'money.dart';

/// Money: what can be paid now and where it goes, the statement and invoices, then earnings from delivered orders month by month.
class EarningsScreen extends ConsumerWidget {
  const EarningsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(earningsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Money')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(earningsProvider)),
        data: (e) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(earningsProvider);
            ref.invalidate(payoutSummaryProvider);
          },
          child: ListView(padding: const EdgeInsets.all(16), children: [
            const PayoutCard(),
            const SizedBox(height: 4),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('Statement'),
              subtitle: const Text('Every sale, fee, tax and payout'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const StatementScreen())),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('Invoices'),
              subtitle: const Text('Tax invoices, credit notes and PetApp’s fee invoices'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const InvoicesScreen())),
            ),
            const Divider(),
            const SizedBox(height: 8),
            Card(
              elevation: 0,
              color: const Color(0xFFDCEBE8),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Earned from delivered orders', style: TextStyle(color: Brand.muted)),
                  const SizedBox(height: 4),
                  Text(rupees(e.earnedPaise), style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700, color: Brand.teal)),
                  const SizedBox(height: 8),
                  Text('${e.deliveredOrders} order${e.deliveredOrders == 1 ? '' : 's'} · sales ${rupees(e.salesPaise)} · PetApp fee ${rupees(e.commissionPaise)}'),
                ]),
              ),
            ),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.local_shipping_outlined),
              title: Text('${rupees(e.expectedPaise)} on its way'),
              subtitle: Text('${e.inProgressOrders} order${e.inProgressOrders == 1 ? '' : 's'} not delivered yet. Counted once delivered.'),
            ),
            const Divider(),
            Text('By month', style: Theme.of(context).textTheme.titleMedium),
            if (e.months.isEmpty)
              const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Nothing delivered yet.', style: TextStyle(color: Brand.muted)))
            else
              for (final m in e.months)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(monthName(m.month)),
                  subtitle: Text('${m.orders} order${m.orders == 1 ? '' : 's'} · fee ${rupees(m.commissionPaise)}'),
                  trailing: Text(rupees(m.earnedPaise), style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(border: Border.all(color: Brand.line), borderRadius: BorderRadius.circular(12)),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.info_outline, color: Brand.muted, size: 20),
                const SizedBox(width: 8),
                Expanded(child: Text(e.payoutNote, style: const TextStyle(color: Brand.muted))),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
