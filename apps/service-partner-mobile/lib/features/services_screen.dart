import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';

class ServicesScreen extends ConsumerWidget {
  const ServicesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(profileProvider).valueOrNull;
    final services = p?.services ?? const <PartnerServiceItem>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Services and prices')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const ServiceForm())),
        icon: const Icon(Icons.add),
        label: const Text('Add service'),
      ),
      body: services.isEmpty
          ? const EmptyView(title: 'No services yet', message: 'Add what you offer, how long it takes and the price.')
          : ListView(children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('PetApp keeps the fee shown on each service when a booking is completed; the rest is yours.', style: TextStyle(color: Brand.muted)),
              ),
              for (final s in services)
                ListTile(
                  title: Text(s.name, style: TextStyle(decoration: s.isActive ? null : TextDecoration.lineThrough)),
                  subtitle: Text('${s.categoryName} · ${s.durationMin} min · ${s.modes.map((m) => m == 'AT_HOME' ? 'home visit' : 'at centre').join(' or ')}${p == null ? '' : ' · PetApp fee ${percent(p.feeBpsFor(s))}'}${s.isActive ? '' : ' · paused'}'),
                  trailing: Text(rupees(s.pricePaise), style: const TextStyle(fontWeight: FontWeight.w700)),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ServiceForm(service: s))),
                ),
            ]),
    );
  }
}

class ServiceForm extends ConsumerStatefulWidget {
  const ServiceForm({super.key, this.service});
  final PartnerServiceItem? service;
  @override
  ConsumerState<ServiceForm> createState() => _ServiceFormState();
}

class _ServiceFormState extends ConsumerState<ServiceForm> {
  late final s = widget.service;
  late final _name = TextEditingController(text: s?.name);
  late final _desc = TextEditingController(text: s?.description);
  late final _price = TextEditingController(text: s == null ? '' : (s!.pricePaise / 100).toStringAsFixed(s!.pricePaise % 100 == 0 ? 0 : 2));
  late int _duration = s?.durationMin ?? 60;
  late int _buffer = s?.bufferMin ?? 0;
  late String? _categoryId = s?.categoryId;
  late final Set<String> _modes = {...?s?.modes};
  late bool _active = s?.isActive ?? true;
  bool _busy = false;

  /// "799" or "799.50" → paise, exactly (no floating point).
  static int? paise(String input) {
    final m = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(input.trim().replaceAll(',', ''));
    if (m == null) return null;
    return int.parse(m[1]!) * 100 + int.parse((m[2] ?? '').padRight(2, '0'));
  }

  Future<void> _save() async {
    final price = paise(_price.text);
    if (_categoryId == null || _name.text.trim().isEmpty) return showMessage(context, 'Choose a category and name the service.');
    if (price == null || price < 100) return showMessage(context, 'Enter a price of at least ₹1.');
    if (_modes.isEmpty) return showMessage(context, 'Choose at least one: at your centre or home visit.');
    final body = <String, Object?>{
      'categoryId': _categoryId, 'name': _name.text.trim(), 'description': _desc.text.trim().isEmpty ? null : _desc.text.trim(),
      'durationMin': _duration, 'bufferMin': _buffer, 'pricePaise': price, 'modes': _modes.toList(), 'isActive': _active,
    }..removeWhere((_, v) => v == null);
    setState(() => _busy = true);
    try {
      final api = ref.read(apiProvider);
      s == null ? await api.addService(body) : await api.updateService(s!.id, body);
      ref.invalidate(profileProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _desc.dispose();
    _price.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cats = ref.watch(categoriesProvider);
    final homeVisits = (ref.watch(profileProvider).valueOrNull?.homeVisitRadiusKm ?? 0) > 0;
    return Scaffold(
      appBar: AppBar(title: Text(s == null ? 'Add service' : 'Edit service')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        cats.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(categoriesProvider)),
          data: (list) => DropdownButtonFormField<String>(
            value: _categoryId,
            decoration: const InputDecoration(labelText: 'Category'),
            items: [for (final c in list) DropdownMenuItem(value: c.id, child: Text(c.name))],
            onChanged: (v) => setState(() => _categoryId = v),
          ),
        ),
        const SizedBox(height: 12),
        TextField(controller: _name, maxLength: 100, decoration: const InputDecoration(labelText: 'Service name', hintText: 'Full groom (small dog)')),
        TextField(controller: _desc, maxLength: 1000, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'What’s included (optional)')),
        const SizedBox(height: 12),
        TextField(
          controller: _price,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))],
          decoration: const InputDecoration(labelText: 'Price', prefixText: '₹ '),
        ),
        const SizedBox(height: 16),
        Text('Takes $_duration minutes'),
        Slider(value: _duration.toDouble(), min: 15, max: 480, divisions: 31, label: '$_duration min', onChanged: (v) => setState(() => _duration = (v / 15).round() * 15)),
        Text('Gap after each booking: $_buffer minutes'),
        Slider(value: _buffer.toDouble(), max: 120, divisions: 8, label: '$_buffer min', onChanged: (v) => setState(() => _buffer = (v / 15).round() * 15)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [
          FilterChip(label: const Text('At my centre'), selected: _modes.contains('AT_CENTER'), onSelected: (on) => setState(() => on ? _modes.add('AT_CENTER') : _modes.remove('AT_CENTER'))),
          FilterChip(
            label: const Text('Home visit'),
            selected: _modes.contains('AT_HOME'),
            onSelected: homeVisits ? (on) => setState(() => on ? _modes.add('AT_HOME') : _modes.remove('AT_HOME')) : null,
          ),
        ]),
        if (!homeVisits) const Text('To offer home visits, set a home-visit distance in Business details.', style: TextStyle(color: Brand.muted, fontSize: 12)),
        if (s != null) SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Accepting bookings'), value: _active, onChanged: (v) => setState(() => _active = v)),
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save')),
      ]),
    );
  }
}
