import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'chat/business_chat.dart';

const statusLabels = {
  'PENDING_PAYMENT': 'Awaiting payment',
  'CONFIRMED': 'Confirmed',
  'IN_PROGRESS': 'In progress',
  'COMPLETED': 'Completed',
  'CANCELLED': 'Cancelled',
  'NO_SHOW': 'No-show',
  'EXPIRED': 'Expired',
};

class BookingsScreen extends StatelessWidget {
  const BookingsScreen({super.key});
  @override
  Widget build(BuildContext context) => const DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: _Bar(),
          body: TabBarView(children: [_List(when: 'upcoming'), _List(when: 'past')]),
        ),
      );
}

class _Bar extends StatelessWidget implements PreferredSizeWidget {
  const _Bar();
  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight + kTextTabBarHeight);
  @override
  Widget build(BuildContext context) => AppBar(title: const Text('Bookings'), actions: const [MessagesButton()], bottom: const TabBar(tabs: [Tab(text: 'Upcoming'), Tab(text: 'Past')]));
}

class _List extends ConsumerWidget {
  const _List({required this.when});
  final String when;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(bookingsProvider(when)).when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(bookingsProvider(when))),
        data: (items) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(bookingsProvider(when)),
          child: items.isEmpty
              ? ListView(children: [SizedBox(height: 320, child: EmptyView(title: when == 'upcoming' ? 'No upcoming bookings' : 'No past bookings yet', message: when == 'upcoming' ? 'New bookings appear here as soon as customers pay.' : null))])
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (ctx, i) => BookingCard(booking: items[i], onChanged: () {
                    ref.invalidate(bookingsProvider('upcoming'));
                    ref.invalidate(bookingsProvider('past'));
                    ref.invalidate(earningsProvider);
                    ref.invalidate(payoutSummaryProvider);
                  }),
                ),
        ),
      );
}

class BookingCard extends ConsumerStatefulWidget {
  const BookingCard({super.key, required this.booking, required this.onChanged});
  final Booking booking;
  final VoidCallback onChanged;
  @override
  ConsumerState<BookingCard> createState() => _BookingCardState();
}

class _BookingCardState extends ConsumerState<BookingCard> {
  bool _busy = false;

  Future<void> _act(String label, Future<Booking> Function() f, {String? done}) async {
    setState(() => _busy = true);
    try {
      await f();
      widget.onChanged();
      if (mounted && done != null) showMessage(context, done);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String title, String body, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(action))],
        ),
      ) ==
      true;

  Future<void> _cancel(Booking b) async {
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this booking?'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('The customer gets a full refund and is told the reason. Frequent cancellations affect your listing.'),
          TextField(controller: reason, autofocus: true, maxLength: 300, decoration: const InputDecoration(labelText: 'Reason for the customer')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel booking'))],
      ),
    );
    if (ok != true) return;
    if (reason.text.trim().length < 3) {
      if (mounted) showMessage(context, 'Please give the customer a reason.');
      return;
    }
    await _act('cancel', () => ref.read(apiProvider).cancel(b.id, reason.text.trim()), done: 'Cancelled. The customer will be refunded in full.');
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final started = DateTime.now().isAfter(b.startsAt);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: b.status == 'IN_PROGRESS' ? Brand.teal : Brand.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(when(b.startsAt), style: const TextStyle(fontWeight: FontWeight.w700))),
          Text(statusLabels[b.status] ?? b.status, style: TextStyle(color: b.isOpen ? Brand.teal : Brand.muted, fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 4),
        Text('${b.serviceName} for ${b.petName} · ${b.mode == 'AT_HOME' ? 'home visit' : 'at your centre'}'),
        Text('${b.customerName} · ${b.code}', style: const TextStyle(color: Brand.muted)),
        if (b.address != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('📍 ${b.address}')),
        if (b.customerNote != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('“${b.customerNote}”', style: const TextStyle(fontStyle: FontStyle.italic))),
        if (b.cancelReason != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Cancelled: ${b.cancelReason}', style: const TextStyle(color: Brand.heart))),
        const SizedBox(height: 6),
        Text('You earn ${rupees(b.earningPaise)} (price ${rupees(b.pricePaise)}, PetApp fee ${rupees(b.feePaise)})', style: const TextStyle(color: Brand.muted, fontSize: 12)),
        Wrap(spacing: 8, children: [
          TextButton.icon(onPressed: () => openCustomerChat(context, ref, b.id), icon: const Icon(Icons.chat_bubble_outline), label: const Text('Message')),
          TextButton.icon(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => NewTicketScreen(refType: 'BOOKING', refId: b.id, refLabel: 'booking ${b.code}'))),
            icon: const Icon(Icons.help_outline),
            label: const Text('Get help'),
          ),
        ]),
        if (b.isOpen || b.customerPhone != null)
          Wrap(spacing: 8, children: [
            if (b.customerPhone != null && b.isOpen)
              TextButton.icon(onPressed: () => launchUrl(Uri(scheme: 'tel', path: b.customerPhone)), icon: const Icon(Icons.call_outlined), label: const Text('Call')),
            if (b.canStart)
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: _busy ? null : () => _act('start', () => ref.read(apiProvider).start(b.id), done: 'Started'),
                child: const Text('Start'),
              ),
            if (b.status == 'IN_PROGRESS')
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: _busy ? null : () => _act('complete', () => ref.read(apiProvider).complete(b.id), done: 'Completed. Nice work!'),
                child: const Text('Mark complete'),
              ),
            if (b.status == 'CONFIRMED' && started)
              TextButton(
                onPressed: _busy
                    ? null
                    : () async {
                        if (await _confirm('Mark as no-show?', 'Only if ${b.customerName} didn’t turn up and couldn’t be reached.', 'Mark no-show')) {
                          await _act('no-show', () => ref.read(apiProvider).noShow(b.id), done: 'Marked as no-show');
                        }
                      },
                child: const Text('No-show'),
              ),
            if (b.status == 'CONFIRMED') TextButton(onPressed: _busy ? null : () => _cancel(b), child: const Text('Cancel', style: TextStyle(color: Brand.heart))),
          ]),
      ]),
    );
  }
}
