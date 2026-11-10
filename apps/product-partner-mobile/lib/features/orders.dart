import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'chat/business_chat.dart';

/// Order stages a seller works through, in order. null = everything.
const orderFilters = <(String?, String)>[
  ('CONFIRMED', 'To pack'),
  ('PACKED', 'To ship'),
  ('SHIPPED', 'In transit'),
  ('RETURN_REQUESTED', 'Returns'),
  ('DELIVERED', 'Delivered'),
  ('CANCELLED', 'Cancelled'),
  ('RETURNED', 'Returned'),
  (null, 'All'),
];

String orderStatusLabel(String s) => switch (s) {
      'CONFIRMED' => 'To pack',
      'PACKED' => 'Packed',
      'SHIPPED' => 'Shipped',
      'DELIVERED' => 'Delivered',
      'CANCELLED' => 'Cancelled',
      'RETURN_REQUESTED' => 'Return requested',
      'RETURNED' => 'Returned',
      _ => s,
    };

final orderFilterProvider = StateProvider<String?>((_) => 'CONFIRMED');

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(orderFilterProvider);
    final version = ref.watch(ordersVersionProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Orders'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: SizedBox(
            height: 52,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), children: [
              for (final (status, label) in orderFilters)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(label: Text(label), selected: filter == status, onSelected: (_) => ref.read(orderFilterProvider.notifier).state = status),
                ),
            ]),
          ),
        ),
      ),
      // Keyed so a new filter or a refresh starts again from page 1.
      body: _OrderList(key: ValueKey('$filter/$version'), status: filter),
    );
  }
}

class _OrderList extends ConsumerStatefulWidget {
  const _OrderList({super.key, required this.status});
  final String? status;
  @override
  ConsumerState<_OrderList> createState() => _OrderListState();
}

class _OrderListState extends ConsumerState<_OrderList> {
  final _items = <VendorOrder>[];
  int _page = 0;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading || !_more) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final (items, more) = await ref.read(apiProvider).orders(status: widget.status, page: _page + 1);
      if (!mounted) return;
      setState(() {
        _items.addAll(items);
        _page++;
        _more = more;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_items.isEmpty && _loading) return const LoadingView();
    if (_items.isEmpty && _error != null) return ErrorView(error: _error!, onRetry: _load);
    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: () async => refreshSales(ref),
        child: ListView(children: [
          const SizedBox(height: 80),
          EmptyView(
            title: switch (widget.status) { 'CONFIRMED' => 'Nothing to pack', 'PACKED' => 'Nothing waiting to ship', 'RETURN_REQUESTED' => 'No returns to handle', _ => 'No orders here' },
            message: widget.status == 'CONFIRMED' ? 'New paid orders show up here.' : null,
          ),
        ]),
      );
    }
    return RefreshIndicator(
      onRefresh: () async => refreshSales(ref),
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _load();
          return false;
        },
        child: ListView.separated(
          itemCount: _items.length + (_more ? 1 : 0),
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            if (i == _items.length) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
            final o = _items[i];
            final ret = o.openReturn;
            return ListTile(
              title: Text('${o.code} · ${o.units} item${o.units == 1 ? '' : 's'}'),
              subtitle: Text([
                '${o.customerName ?? 'Customer'} · ${when(o.createdAt)}',
                o.items.map((x) => '${x.qty}× ${x.productTitle} (${x.variantTitle})').join(', '),
                if (ret != null) ret.status == 'REQUESTED' ? 'Return requested: ${ret.reason}' : 'Return approved: waiting for it to come back',
              ].join('\n')),
              isThreeLine: true,
              trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(rupees(o.totalPaise), style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(orderStatusLabel(o.status), style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => OrderDetailScreen(order: o)));
              },
            );
          },
        ),
      ),
    );
  }
}

class OrderDetailScreen extends ConsumerStatefulWidget {
  const OrderDetailScreen({super.key, required this.order});
  final VendorOrder order;
  @override
  ConsumerState<OrderDetailScreen> createState() => _OrderDetailState();
}

class _OrderDetailState extends ConsumerState<OrderDetailScreen> {
  late VendorOrder o = widget.order;
  bool _busy = false;

  Future<void> _run(Future<VendorOrder> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      final updated = await action();
      if (!mounted) return;
      setState(() => o = updated);
      refreshSales(ref);
      if (mounted) showMessage(context, done);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _ask(String title, String label, {String? hint, String action = 'Confirm'}) => showDialog<String>(
        context: context,
        builder: (ctx) {
          final c = TextEditingController();
          return AlertDialog(
            title: Text(title),
            content: TextField(controller: c, autofocus: true, maxLines: 3, minLines: 1, decoration: InputDecoration(labelText: label, helperText: hint, helperMaxLines: 2)),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back')),
              FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: Text(action)),
            ],
          );
        },
      );

  Future<void> _ship() async {
    final courier = TextEditingController(text: o.courier);
    final tracking = TextEditingController(text: o.trackingNumber);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hand over to courier'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: courier, autofocus: true, decoration: const InputDecoration(labelText: 'Courier', hintText: 'e.g. Delhivery, Blue Dart')),
          const SizedBox(height: 12),
          TextField(controller: tracking, decoration: const InputDecoration(labelText: 'Tracking number', helperText: 'The customer sees this to track the parcel')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Mark shipped')),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() => ref.read(apiProvider).ship(o.id, courier.text.trim(), tracking.text.trim()), 'Marked as shipped. The customer has the tracking number.');
  }

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiProvider);
    final ret = o.openReturn;
    final s = o.shipTo;
    final phone = s?.phone ?? o.customerPhone;
    final recipient = (s?.name.isNotEmpty ?? false) ? s!.name : (o.customerName ?? 'Customer');
    Widget row(String l, String v, {bool bold = false, Color? color}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(children: [
            Expanded(child: Text(l, style: TextStyle(color: color ?? Brand.muted))),
            Text(v, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.normal, color: color)),
          ]),
        );
    return Scaffold(
      appBar: AppBar(title: Text(o.code)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(orderStatusLabel(o.status), style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
        Text('Order ${o.orderCode} · placed ${when(o.createdAt)}', style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 16),
        for (final i in o.items)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${i.productTitle} · ${i.variantTitle}'),
            subtitle: Text('SKU ${i.sku} · ${i.qty} × ${rupees(i.unitPricePaise)}'),
            trailing: Text(rupees(i.lineTotalPaise)),
          ),
        const Divider(),
        row('Items', rupees(o.itemsPaise)),
        if (o.discountPaise > 0) row('Discount', '−${rupees(o.discountPaise)}'),
        if (o.shippingPaise > 0) row('Shipping', rupees(o.shippingPaise)),
        row('Customer paid', rupees(o.totalPaise), bold: true),
        row('PetApp fee', '−${rupees(o.commissionPaise)}'),
        row('You earn', rupees(o.vendorEarningPaise), bold: true, color: Brand.teal),
        const Divider(height: 32),
        if (s != null) ...[
          const Text('Ship to', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          SelectableText('$recipient${phone != null ? ' · $phone' : ''}\n${s.lines}'),
          Row(children: [
            TextButton.icon(
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('Copy address'),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: '$recipient\n${s.lines}${phone != null ? '\n$phone' : ''}'));
                showMessage(context, 'Address copied');
              },
            ),
            if (phone != null)
              TextButton.icon(icon: const Icon(Icons.call_outlined, size: 18), label: const Text('Call'), onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone))),
          ]),
        ],
        if (o.courier != null) ...[const SizedBox(height: 8), Text('${o.courier} · ${o.trackingNumber ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600))],
        Wrap(spacing: 8, children: [
          TextButton.icon(onPressed: () => openCustomerChat(context, ref, o.id), icon: const Icon(Icons.chat_bubble_outline), label: const Text('Message customer')),
          TextButton.icon(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => NewTicketScreen(refType: 'ORDER', refId: o.id, refLabel: 'order ${o.code}'))),
            icon: const Icon(Icons.help_outline),
            label: const Text('Get help'),
          ),
        ]),
        const SizedBox(height: 8),
        _Timeline(o),
        if (o.status == 'CANCELLED')
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text('Cancelled${o.cancelledBy != null ? ' by ${o.cancelledBy!.toLowerCase()}' : ''}${o.cancelReason != null ? ': ${o.cancelReason}' : ''}. The customer is refunded for this parcel and the stock was put back.'),
          ),
        for (final r in o.returns)
          Card(
            elevation: 0,
            margin: const EdgeInsets.only(top: 16),
            color: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Brand.line)),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Return · ${switch (r.status) { 'REQUESTED' => 'waiting for your decision', 'APPROVED' => 'approved, on its way back', 'REJECTED' => 'not accepted', _ => 'received, refunded' }}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text('Reason: ${r.reason}'),
                Text('Refund to the customer: ${rupees(r.refundPaise)}'),
                if (r.note != null) Text('Your note: ${r.note}', style: const TextStyle(color: Brand.muted)),
              ]),
            ),
          ),
        const SizedBox(height: 24),
        if (_busy) const LoadingView(),
        if (!_busy) ...[
          if (o.canPack) FilledButton(onPressed: () => _run(() => api.pack(o.id), 'Marked as packed.'), child: const Text('Mark packed')),
          if (o.canShip) FilledButton(onPressed: _ship, child: const Text('Mark shipped')),
          if (o.canDeliver)
            FilledButton(
              onPressed: () => _run(() => api.deliver(o.id), 'Marked as delivered.'),
              child: const Text('Mark delivered'),
            ),
          if (ret != null && ret.status == 'REQUESTED') ...[
            FilledButton(onPressed: () => _run(() => api.decideReturn(ret.id, 'APPROVE'), 'Return approved. The customer will send it back.'), child: const Text('Approve return')),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () async {
                final note = await _ask('Decline the return', 'Why can’t it be returned?', hint: 'The customer sees this.', action: 'Decline');
                if (note == null || note.isEmpty) return;
                await _run(() => api.decideReturn(ret.id, 'REJECT', note: note), 'Return declined.');
              },
              child: const Text('Decline return'),
            ),
          ],
          if (ret != null && ret.status == 'APPROVED')
            FilledButton(
              onPressed: () async {
                final note = await _ask('Item received back', 'Condition note (optional)', hint: 'e.g. Sealed, unused', action: 'Confirm & refund');
                if (note == null) return;
                await _run(() => api.decideReturn(ret.id, 'RECEIVED', note: note.isEmpty ? null : note), 'Return received. The customer will be refunded.');
              },
              child: const Text('Item received back'),
            ),
          if (o.canCancel) ...[
            const SizedBox(height: 8),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: Brand.heart),
              onPressed: () async {
                final reason = await _ask('Cancel this parcel?', 'Reason', hint: 'The customer sees this and gets a refund for the parcel.', action: 'Cancel parcel');
                if (reason == null || reason.length < 3) return;
                await _run(() => api.cancel(o.id, reason), 'Cancelled. The customer will be refunded.');
              },
              child: const Text('Can’t fulfil? Cancel parcel'),
            ),
          ],
        ],
      ]),
    );
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline(this.o);
  final VendorOrder o;
  @override
  Widget build(BuildContext context) {
    final steps = <(String, DateTime?)>[('Paid', o.createdAt), ('Packed', o.packedAt), ('Shipped', o.shippedAt), ('Delivered', o.deliveredAt)];
    return Column(children: [
      for (final (label, at) in steps)
        Row(children: [
          Icon(at != null ? Icons.check_circle : Icons.radio_button_unchecked, size: 18, color: at != null ? Brand.teal : Brand.line),
          const SizedBox(width: 8),
          Expanded(child: Text(label)),
          if (at != null) Text(when(at), style: const TextStyle(color: Brand.muted, fontSize: 12)),
        ]),
    ]);
  }
}
