import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'money.dart';

const _months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
String monthName(String ym) {
  final parts = ym.split('-');
  return parts.length == 2 ? '${_months[int.parse(parts[1]) - 1]} ${parts[0]}' : ym;
}

class EarningsScreen extends ConsumerWidget {
  const EarningsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Money')),
        body: ref.watch(earningsProvider).when(
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
                    subtitle: const Text('Every visit, fee, tax and payout'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const StatementScreen())),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.picture_as_pdf_outlined),
                    title: const Text('Invoices'),
                    subtitle: const Text('Invoices to customers and PetApp’s fee invoices'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const InvoicesScreen())),
                  ),
                  const Divider(),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: Brand.teal, borderRadius: BorderRadius.circular(16)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('Earned so far', style: TextStyle(color: Colors.white70)),
                      Text(rupees(e.completed.earnedPaise), style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w700)),
                      Text('${e.completed.visits} completed visit${e.completed.visits == 1 ? '' : 's'} · ${rupees(e.completed.grossPaise)} billed · ${rupees(e.completed.platformFeesPaise)} PetApp fees',
                          style: const TextStyle(color: Colors.white70)),
                    ]),
                  ),
                  const SizedBox(height: 12),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_available, color: Brand.teal),
                    title: Text('${rupees(e.upcomingPaise)} coming up'),
                    subtitle: Text('From ${e.upcomingVisits} confirmed booking${e.upcomingVisits == 1 ? '' : 's'}'),
                  ),
                  if (e.noShows > 0) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.person_off_outlined), title: Text('${e.noShows} no-show${e.noShows == 1 ? '' : 's'}')),
                  const Divider(),
                  const Text('By month', style: TextStyle(fontWeight: FontWeight.w700)),
                  if (e.months.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('Completed visits will show here.', style: TextStyle(color: Brand.muted))),
                  for (final m in e.months)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(monthName(m.month)),
                      subtitle: Text('${m.visits} visit${m.visits == 1 ? '' : 's'} · fees ${rupees(m.platformFeesPaise)}'),
                      trailing: Text(rupees(m.earnedPaise), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  const SizedBox(height: 12),
                  Text(e.payouts, style: const TextStyle(color: Brand.muted, fontSize: 12)),
                ]),
              ),
            ),
      );
}
