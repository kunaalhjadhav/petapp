import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/models.dart';
import '../../common/money_text.dart';
import '../../common/widgets.dart';
import '../../services/payment_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import 'membership_logic.dart';

// Membership plans (spec §40). Shown only when PetApp has switched memberships on.

final _mineProvider = FutureProvider.autoDispose<MyMembership>((ref) => ref.watch(apiProvider).myMembership());
final _plansProvider = FutureProvider.autoDispose<List<MembershipPlan>>((ref) async {
  final mine = await ref.watch(_mineProvider.future);
  return mine.enabled ? ref.watch(apiProvider).membershipPlans() : <MembershipPlan>[];
});

class MembershipScreen extends ConsumerStatefulWidget {
  const MembershipScreen({super.key});
  @override
  ConsumerState<MembershipScreen> createState() => _MembershipScreenState();
}

class _MembershipScreenState extends ConsumerState<MembershipScreen> {
  String? _busy;

  Future<void> _buy(MembershipPlan p) async {
    setState(() => _busy = p.id);
    try {
      final api = ref.read(apiProvider);
      final checkout = await api.buyMembership(p.id);
      await PaymentService(api).pay(checkout, description: '${p.name} membership');
      ref.invalidate(_mineProvider);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Welcome to ${p.name}!')));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mine = ref.watch(_mineProvider);
    final plans = ref.watch(_plansProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Membership')),
      body: mine.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_mineProvider)),
        data: (m) => !m.enabled && m.current == null
            ? const EmptyView(title: 'Memberships aren’t available yet', message: 'Everything in PetApp is open to you.')
            : RefreshIndicator(
                onRefresh: () async => ref.invalidate(_mineProvider),
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  Card(
                    child: ListTile(
                      leading: Icon(m.current == null ? Icons.pets : Icons.workspace_premium, color: Brand.teal),
                      title: Text(membershipHeadline(m), style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(m.current == null ? 'Members get the extras below.' : 'Thanks for being a member. Memberships don’t renew on their own.'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ...plans.when(
                    loading: () => [const LoadingView()],
                    error: (e, _) => [ErrorView(error: e, onRetry: () => ref.invalidate(_plansProvider))],
                    data: (list) => [
                      for (final p in list) _PlanCard(plan: p, mine: m, busy: _busy == p.id, onBuy: _busy == null ? () => _buy(p) : null),
                    ],
                  ),
                  if (m.history.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    const Text('Earlier', style: TextStyle(fontWeight: FontWeight.w700)),
                    for (final h in m.history)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(h.plan.name),
                        subtitle: Text([
                          if (h.startsAt != null && h.endsAt != null) '${shortDate(h.startsAt!)} – ${shortDate(h.endsAt!)}',
                          if (h.status == 'REVOKED') 'Ended by PetApp',
                          if (h.source == 'GRANT') 'Gift from PetApp',
                        ].join(' · ')),
                      ),
                  ],
                  const SizedBox(height: 16),
                  const Text('Paid securely through the payment gateway. A membership starts when payment is confirmed, or when your current one ends if you renew early.',
                      style: TextStyle(color: Brand.muted, fontSize: 12)),
                ]),
              ),
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, required this.mine, required this.busy, required this.onBuy});
  final MembershipPlan plan;
  final MyMembership mine;
  final bool busy;
  final VoidCallback? onBuy;
  @override
  Widget build(BuildContext context) {
    final action = planAction(plan, mine);
    final current = mine.current?.plan.id == plan.id || (mine.current == null && plan.isFree);
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: current ? Brand.teal : const Color(0xFFDCE0DC), width: current ? 2 : 1)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(plan.name, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
            if (current) const Chip(label: Text('Your plan'), visualDensity: VisualDensity.compact),
          ]),
          Text(planPrice(plan), style: const TextStyle(color: Brand.muted)),
          if (plan.description.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(plan.description)),
          const SizedBox(height: 8),
          for (final l in plan.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.check_circle, size: 18, color: Brand.teal),
                const SizedBox(width: 8),
                Expanded(child: Text(l)),
              ]),
            ),
          if (action != null) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton(onPressed: action.enabled && onBuy != null ? onBuy : null, child: Text(busy ? 'Opening payment…' : action.label)),
            ),
          ],
        ]),
      ),
    );
  }
}
