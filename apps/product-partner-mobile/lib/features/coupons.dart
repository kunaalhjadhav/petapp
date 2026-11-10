import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';

String couponValue(Coupon c) => c.kind == 'PERCENT'
    ? '${percent(c.value)} off${c.maxDiscountPaise != null ? ' (up to ${rupees(c.maxDiscountPaise!)})' : ''}'
    : '${rupees(c.value)} off';

String couponStateLabel(String s) => switch (s) { 'RUNNING' => 'Running', 'SCHEDULED' => 'Starts later', 'ENDED' => 'Ended', 'PAUSED' => 'Paused', 'USED_UP' => 'Used up', _ => s };

/// The seller's own coupons. They only discount this seller's items, and the seller funds the discount.
class CouponsScreen extends ConsumerWidget {
  const CouponsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(couponsProvider);
    void open([Coupon? c]) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CouponEditorScreen(coupon: c)));
    return Scaffold(
      appBar: AppBar(title: const Text('Coupons')),
      floatingActionButton: FloatingActionButton.extended(onPressed: open, icon: const Icon(Icons.add), label: const Text('New coupon')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(couponsProvider)),
        data: (list) {
          final now = DateTime.now();
          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Your coupons only discount your products, and the discount comes out of your earnings (PetApp’s fee is worked out on the discounted price).',
                  style: TextStyle(color: Brand.muted)),
            ),
            if (list.isEmpty) const EmptyView(title: 'No coupons yet', message: 'Create a code like LAUNCH15 and share it with your customers.'),
            for (final c in list)
              ListTile(
                title: Text(c.code, style: const TextStyle(fontWeight: FontWeight.w700, letterSpacing: 1)),
                subtitle: Text([
                  couponValue(c),
                  if (c.minOrderPaise > 0) 'on ${rupees(c.minOrderPaise)}+',
                  '${day(c.startsAt)} – ${day(c.endsAt)}',
                  'used ${c.usedCount}${c.usageLimit != null ? ' of ${c.usageLimit}' : ''}',
                ].join(' · ')),
                trailing: Text(couponStateLabel(c.stateAt(now)), style: TextStyle(color: c.stateAt(now) == 'RUNNING' ? Brand.teal : Brand.muted, fontWeight: FontWeight.w600)),
                onTap: () => open(c),
              ),
          ]);
        },
      ),
    );
  }
}

class CouponEditorScreen extends ConsumerStatefulWidget {
  const CouponEditorScreen({super.key, this.coupon});
  final Coupon? coupon;
  @override
  ConsumerState<CouponEditorScreen> createState() => _CouponEditorState();
}

class _CouponEditorState extends ConsumerState<CouponEditorScreen> {
  late final c = widget.coupon;
  late final _code = TextEditingController(text: c?.code);
  late final _description = TextEditingController(text: c?.description);
  late String _kind = c?.kind ?? 'PERCENT';
  late final _value = TextEditingController(text: c == null ? '' : (c!.kind == 'PERCENT' ? '${c!.value / 100}'.replaceFirst(RegExp(r'\.0$'), '') : rupeesInput(c!.value)));
  late final _cap = TextEditingController(text: c?.maxDiscountPaise == null ? '' : rupeesInput(c!.maxDiscountPaise!));
  late final _min = TextEditingController(text: c == null || c!.minOrderPaise == 0 ? '' : rupeesInput(c!.minOrderPaise));
  late final _limit = TextEditingController(text: c?.usageLimit?.toString() ?? '');
  late final _perUser = TextEditingController(text: '${c?.perUserLimit ?? 1}');
  late DateTime _starts = c?.startsAt.toLocal() ?? DateTime.now();
  late DateTime _ends = c?.endsAt.toLocal() ?? DateTime.now().add(const Duration(days: 30));
  late bool _active = c?.isActive ?? true;
  bool _busy = false;

  @override
  void dispose() {
    for (final x in [_code, _description, _value, _cap, _min, _limit, _perUser]) {
      x.dispose();
    }
    super.dispose();
  }

  Future<void> _pick(bool start) async {
    final cur = start ? _starts : _ends;
    final earliest = DateTime.now().subtract(const Duration(days: 365));
    final d = await showDatePicker(context: context, initialDate: cur, firstDate: cur.isBefore(earliest) ? cur : earliest, lastDate: DateTime.now().add(const Duration(days: 730)));
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(cur));
    if (t == null) return;
    setState(() {
      final x = DateTime(d.year, d.month, d.day, t.hour, t.minute);
      if (start) {
        _starts = x;
      } else {
        _ends = x;
      }
    });
  }

  Future<void> _save() async {
    int? bps(String s) {
      final v = double.tryParse(s.trim());
      return v == null ? null : (v * 100).round();
    }

    final value = _kind == 'PERCENT' ? bps(_value.text) : paiseFrom(_value.text);
    if (value == null || value < 1) return showMessage(context, _kind == 'PERCENT' ? 'Enter the discount as a percentage, e.g. 15.' : 'Enter the discount in rupees, e.g. 50.');
    final body = <String, Object?>{
      if (c == null) 'code': _code.text.trim().toUpperCase(),
      'description': _description.text.trim().isEmpty ? null : _description.text.trim(),
      'kind': _kind,
      'value': value,
      'maxDiscountPaise': _kind == 'PERCENT' ? paiseFrom(_cap.text) : null,
      'minOrderPaise': paiseFrom(_min.text) ?? 0,
      'usageLimit': int.tryParse(_limit.text.trim()),
      'perUserLimit': int.tryParse(_perUser.text.trim()) ?? 1,
      'startsAt': _starts.toUtc().toIso8601String(),
      'endsAt': _ends.toUtc().toIso8601String(),
      'isActive': _active,
    };
    // A new coupon leaves blanks out; an edit sends them as null, which clears a cap or limit the seller removed.
    if (c == null) body.removeWhere((_, x) => x == null);
    setState(() => _busy = true);
    try {
      final api = ref.read(apiProvider);
      c == null ? await api.createCoupon(body) : await api.updateCoupon(c!.id, body);
      ref.invalidate(couponsProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final money = [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))];
    return Scaffold(
      appBar: AppBar(title: Text(c == null ? 'New coupon' : c!.code)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (c == null)
          TextField(
            controller: _code,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')), LengthLimitingTextInputFormatter(20)],
            decoration: const InputDecoration(labelText: 'Code', helperText: '3–20 letters or numbers. Customers type this at checkout.'),
          )
        else
          Text('Used ${c!.usedCount} time${c!.usedCount == 1 ? '' : 's'}. The code can’t be changed.', style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 12),
        TextField(controller: _description, decoration: const InputDecoration(labelText: 'Description (optional)', hintText: 'e.g. Launch offer')),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'PERCENT', label: Text('Percent off')), ButtonSegment(value: 'FLAT', label: Text('Rupees off'))],
          selected: {_kind},
          showSelectedIcon: false,
          onSelectionChanged: (s) => setState(() => _kind = s.first),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _value,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: money,
              decoration: InputDecoration(labelText: 'Discount', prefixText: _kind == 'FLAT' ? '₹' : null, suffixText: _kind == 'PERCENT' ? '%' : null),
            ),
          ),
          if (_kind == 'PERCENT') ...[
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _cap, keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: money, decoration: const InputDecoration(labelText: 'Max discount (optional)', prefixText: '₹'))),
          ],
        ]),
        const SizedBox(height: 12),
        TextField(controller: _min, keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: money, decoration: const InputDecoration(labelText: 'Minimum spend on your items (optional)', prefixText: '₹')),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: TextField(controller: _limit, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Total uses (optional)'))),
          const SizedBox(width: 8),
          Expanded(child: TextField(controller: _perUser, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Uses per customer'))),
        ]),
        const SizedBox(height: 8),
        ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.play_circle_outline), title: const Text('Starts'), subtitle: Text(when(_starts)), onTap: () => _pick(true)),
        ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.stop_circle_outlined), title: const Text('Ends'), subtitle: Text(when(_ends)), onTap: () => _pick(false)),
        SwitchListTile(contentPadding: EdgeInsets.zero, value: _active, onChanged: (x) => setState(() => _active = x), title: const Text('Active'), subtitle: const Text('Turn off to pause the coupon')),
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save')),
      ]),
    );
  }
}
