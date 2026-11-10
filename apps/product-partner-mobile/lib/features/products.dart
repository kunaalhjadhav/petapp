import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../services/uploads.dart';
import '../state/providers.dart';
import '../theme.dart';

String productStatusLabel(String s) => switch (s) { 'DRAFT' => 'Draft', 'ACTIVE' => 'Live', 'INACTIVE' => 'Paused', 'BLOCKED' => 'Blocked', _ => s };

String inventoryLabel(String? s) =>
    switch (s) { 'IN_STOCK' => 'In stock', 'LOW_STOCK' => 'Low stock', 'OUT_OF_STOCK' => 'Out of stock', 'DISCONTINUED' => 'Not sold', _ => '' };

Color inventoryColor(String? s) => switch (s) { 'LOW_STOCK' => const Color(0xFFB7791F), 'OUT_OF_STOCK' => Brand.heart, 'DISCONTINUED' => Brand.muted, _ => Brand.teal };

/// GST rates a product can carry (the price already includes it).
const gstRates = {0: '0%', 500: '5%', 1200: '12%', 1800: '18%', 2800: '28%'};

/// Quick stock correction (a recount, a delivery from the supplier). Orders adjust stock on their own.
Future<void> editStock(BuildContext context, WidgetRef ref, {required String variantId, required String label, required int current}) async {
  final c = TextEditingController(text: '$current');
  final v = await showDialog<int>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Units in stock'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 12),
        TextField(controller: c, autofocus: true, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Units you have now')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back')),
        FilledButton(onPressed: () => Navigator.pop(ctx, int.tryParse(c.text)), child: const Text('Save')),
      ],
    ),
  );
  if (v == null) return;
  try {
    await ref.read(apiProvider).setStock(variantId, v);
    refreshSales(ref);
    if (context.mounted) showMessage(context, 'Stock set to $v.');
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

class ProductsScreen extends ConsumerWidget {
  const ProductsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(productsProvider);
    void open([Product? p]) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ProductEditorScreen(product: p)));
    return Scaffold(
      appBar: AppBar(title: const Text('Products')),
      floatingActionButton: FloatingActionButton.extended(onPressed: open, icon: const Icon(Icons.add), label: const Text('Add product')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(productsProvider)),
        data: (list) => list.isEmpty
            ? EmptyView(title: 'No products yet', message: 'Add a product with photos, sizes and prices. It goes live when you say so.', action: FilledButton(onPressed: open, child: const Text('Add product')))
            : RefreshIndicator(
                onRefresh: () async => ref.invalidate(productsProvider),
                child: ListView.separated(
                  padding: const EdgeInsets.only(bottom: 88),
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final p = list[i];
                    final img = p.photos.isEmpty ? null : p.photos.first.url(160);
                    final flag = p.stockFlag;
                    final prices = p.activeVariants.map((v) => v.pricePaise).toList()..sort();
                    return ListTile(
                      leading: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: SizedBox.square(
                          dimension: 52,
                          child: img == null ? const ColoredBox(color: Brand.line, child: Icon(Icons.image_outlined, color: Brand.muted)) : Image.network(img, fit: BoxFit.cover),
                        ),
                      ),
                      title: Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text([
                        if (prices.isNotEmpty) prices.first == prices.last ? rupees(prices.first) : '${rupees(prices.first)}–${rupees(prices.last)}',
                        '${p.activeVariants.length} variant${p.activeVariants.length == 1 ? '' : 's'} · ${p.totalStock} in stock',
                        if (flag != null) inventoryLabel(flag),
                      ].join(' · ')),
                      trailing: _StatusChip(p.status),
                      onTap: () => open(p),
                    );
                  },
                ),
              ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip(this.status);
  final String status;
  @override
  Widget build(BuildContext context) {
    final c = switch (status) { 'ACTIVE' => Brand.teal, 'BLOCKED' => Brand.heart, _ => Brand.muted };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withAlpha(24), borderRadius: BorderRadius.circular(10)),
      child: Text(productStatusLabel(status), style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

/// Create or edit a product: details, photos, variants (size/weight with price and stock), and whether it's live.
class ProductEditorScreen extends ConsumerStatefulWidget {
  const ProductEditorScreen({super.key, this.product});
  final Product? product;
  @override
  ConsumerState<ProductEditorScreen> createState() => _ProductEditorState();
}

class _ProductEditorState extends ConsumerState<ProductEditorScreen> {
  late Product? p = widget.product;
  late final _title = TextEditingController(text: p?.title);
  late final _brand = TextEditingController(text: p?.brand);
  late final _description = TextEditingController(text: p?.description);
  late String? _categoryId = p?.categoryId;
  late final List<Photo> _photos = [...?p?.photos];
  late final List<Variant> _variants = [...?p?.variants];
  bool _busy = false;
  bool _uploading = false;

  bool get _blocked => p?.status == 'BLOCKED';

  @override
  void dispose() {
    _title.dispose();
    _brand.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    if (_photos.length >= 10) return showMessage(context, 'Up to 10 photos per product.');
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'), onTap: () => Navigator.pop(ctx, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose a photo'), onTap: () => Navigator.pop(ctx, ImageSource.gallery)),
        ]),
      ),
    );
    if (source == null) return;
    final x = await ImagePicker().pickImage(source: source, imageQuality: 90, maxWidth: 2400);
    if (x == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final photo = await uploadProductPhoto(ref.read(apiProvider), x.path);
      if (mounted) setState(() => _photos.add(photo));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _editVariant([int? index]) async {
    final v = await showModalBottomSheet<Variant>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => VariantSheet(variant: index == null ? null : _variants[index], takenSkus: {for (var i = 0; i < _variants.length; i++) if (i != index) _variants[i].sku}),
    );
    if (v == null) return;
    setState(() {
      if (index == null) {
        _variants.add(v);
      } else {
        _variants[index] = v;
      }
    });
  }

  /// Saves everything; [status] also moves the product live, pauses it, or leaves it as it is.
  Future<void> _save({String? status}) async {
    if (_categoryId == null) return showMessage(context, 'Choose a category.');
    if (_variants.isEmpty) return showMessage(context, 'Add at least one variant (size, weight or colour) with a price.');
    final body = <String, Object?>{
      'categoryId': _categoryId,
      'title': _title.text.trim(),
      'brand': _brand.text.trim().isEmpty ? null : _brand.text.trim(),
      'description': _description.text.trim(),
      'imageIds': [for (final x in _photos) x.id],
      'variants': [for (final v in _variants) v.toJson()],
      if (status != null && p != null) 'status': status,
    }..removeWhere((_, x) => x == null);
    setState(() => _busy = true);
    try {
      final api = ref.read(apiProvider);
      final isNew = p == null;
      final saved = isNew ? await api.createProduct(body) : await api.updateProduct(p!.id, body);
      // From here on this screen edits the saved product, so pressing save again (e.g. after a refused
      // "go live") updates it instead of creating a duplicate.
      if (isNew && mounted) setState(() => p = saved);
      // A new product starts as a draft; going live is a second step the server checks (photos, an active variant).
      if (isNew && status == 'ACTIVE') await api.updateProduct(saved.id, {'status': 'ACTIVE'});
      ref.invalidate(productsProvider);
      ref.invalidate(dashboardProvider);
      if (!mounted) return;
      showMessage(context, switch (status) { 'ACTIVE' => 'Live in the shop.', 'INACTIVE' => 'Paused. Shoppers can’t see it.', _ => 'Saved.' });
      Navigator.of(context).pop();
    } catch (e) {
      ref.invalidate(productsProvider); // a draft may have been created before the refusal
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cats = ref.watch(categoriesProvider);
    final status = p?.status ?? 'DRAFT';
    return Scaffold(
      appBar: AppBar(title: Text(p == null ? 'New product' : 'Edit product'), actions: [if (p != null) Padding(padding: const EdgeInsets.only(right: 12), child: Center(child: _StatusChip(status)))]),
      body: AbsorbPointer(
        absorbing: _busy || _blocked,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (_blocked)
            Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Brand.heart.withAlpha(20), borderRadius: BorderRadius.circular(12)),
              child: Text('PetApp blocked this product${p?.blockReason != null ? ': ${p!.blockReason}' : ''}. Contact seller support to change it.'),
            ),
          SizedBox(
            height: 96,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (var i = 0; i < _photos.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Stack(children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: SizedBox.square(dimension: 96, child: _photos[i].url(320) == null ? const ColoredBox(color: Brand.line) : Image.network(_photos[i].url(320)!, fit: BoxFit.cover)),
                    ),
                    if (i == 0) Positioned(left: 4, bottom: 4, child: Container(color: Colors.black54, padding: const EdgeInsets.symmetric(horizontal: 4), child: const Text('Cover', style: TextStyle(color: Colors.white, fontSize: 11)))),
                    Positioned(
                      right: 0,
                      top: 0,
                      child: IconButton(
                        visualDensity: VisualDensity.compact,
                        style: IconButton.styleFrom(backgroundColor: Colors.black45, foregroundColor: Colors.white),
                        icon: const Icon(Icons.close, size: 16),
                        tooltip: 'Remove photo',
                        onPressed: () => setState(() => _photos.removeAt(i)),
                      ),
                    ),
                    if (i > 0)
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: IconButton(
                          visualDensity: VisualDensity.compact,
                          style: IconButton.styleFrom(backgroundColor: Colors.black45, foregroundColor: Colors.white),
                          icon: const Icon(Icons.star_outline, size: 16),
                          tooltip: 'Make cover photo',
                          onPressed: () => setState(() => _photos.insert(0, _photos.removeAt(i))),
                        ),
                      ),
                  ]),
                ),
              InkWell(
                onTap: _uploading ? null : _addPhoto,
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  width: 96,
                  decoration: BoxDecoration(border: Border.all(color: Brand.line), borderRadius: BorderRadius.circular(10), color: Colors.white),
                  child: Center(child: _uploading ? const CircularProgressIndicator() : const Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.add_a_photo_outlined), Text('Add photo', style: TextStyle(fontSize: 12))])),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 4),
          const Text('At least one photo to go live. Location data is removed from photos.', style: TextStyle(color: Brand.muted, fontSize: 12)),
          const SizedBox(height: 16),
          cats.when(
            loading: () => const LinearProgressIndicator(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(categoriesProvider)),
            data: (list) => DropdownButtonFormField<String>(
              value: list.any((c) => c.id == _categoryId) ? _categoryId : null,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [for (final c in list) DropdownMenuItem(value: c.id, child: Text(c.parentId == null ? c.name : '   ${c.name}'))],
              onChanged: (v) => setState(() => _categoryId = v),
            ),
          ),
          const SizedBox(height: 12),
          TextField(controller: _title, decoration: const InputDecoration(labelText: 'Product name', hintText: 'e.g. Chicken Jerky Dog Treats')),
          const SizedBox(height: 12),
          TextField(controller: _brand, decoration: const InputDecoration(labelText: 'Brand (optional)')),
          const SizedBox(height: 12),
          TextField(controller: _description, minLines: 3, maxLines: 8, decoration: const InputDecoration(labelText: 'Description', helperText: 'Ingredients, who it’s for, how to use it (at least 10 characters)')),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(child: Text('Variants', style: Theme.of(context).textTheme.titleMedium)),
            TextButton.icon(onPressed: () => _editVariant(), icon: const Icon(Icons.add), label: const Text('Add')),
          ]),
          const Text('Each size, weight or colour with its own SKU, price and stock. Prices include GST.', style: TextStyle(color: Brand.muted, fontSize: 12)),
          for (var i = 0; i < _variants.length; i++) _variantTile(i),
          const SizedBox(height: 24),
          if (_busy) const LoadingView(),
          if (!_busy && !_blocked) ...[
            if (status != 'ACTIVE') FilledButton(onPressed: () => _save(status: 'ACTIVE'), child: const Text('Save and go live')),
            if (status == 'ACTIVE') FilledButton(onPressed: () => _save(), child: const Text('Save changes')),
            const SizedBox(height: 8),
            if (status != 'ACTIVE') OutlinedButton(onPressed: () => _save(), child: Text(p == null ? 'Save as draft' : 'Save, keep hidden')),
            if (status == 'ACTIVE') OutlinedButton(onPressed: () => _save(status: 'INACTIVE'), child: const Text('Save and pause')),
          ],
        ]),
      ),
    );
  }

  Widget _variantTile(int i) {
    final v = _variants[i];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text('${v.title} · ${v.sku}', style: TextStyle(color: v.isActive ? null : Brand.muted)),
      subtitle: Text([
        '${rupees(v.pricePaise)}${v.pricePaise < v.mrpPaise ? ' (MRP ${rupees(v.mrpPaise)}, ${v.discountPercent}% off)' : ''}',
        'GST ${gstRates[v.gstRateBps] ?? percent(v.gstRateBps)}',
        v.isActive ? '${v.stock} in stock' : 'Not sold',
      ].join(' · ')),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        if (v.inventoryStatus != null && v.isActive)
          Text(inventoryLabel(v.inventoryStatus), style: TextStyle(fontSize: 12, color: inventoryColor(v.inventoryStatus))),
        if (v.id != null && v.isActive)
          IconButton(
            tooltip: 'Update stock now',
            icon: const Icon(Icons.inventory_outlined),
            onPressed: () async {
              await editStock(context, ref, variantId: v.id!, label: '${p?.title ?? ''} · ${v.title}', current: v.stock);
              // Show the saved count in the editor.
              final fresh = (await ref.read(productsProvider.future)).where((x) => x.id == p?.id).firstOrNull;
              final fv = fresh?.variants.where((x) => x.id == v.id).firstOrNull;
              if (fv != null && mounted) setState(() => _variants[i] = fv);
            },
          ),
      ]),
      onTap: () => _editVariant(i),
    );
  }
}

/// Add or edit one variant. Removing a saved variant stops selling it (past orders still point at it).
class VariantSheet extends StatefulWidget {
  const VariantSheet({super.key, this.variant, required this.takenSkus});
  final Variant? variant;
  final Set<String> takenSkus;
  @override
  State<VariantSheet> createState() => _VariantSheetState();
}

class _VariantSheetState extends State<VariantSheet> {
  late final v = widget.variant;
  late final _sku = TextEditingController(text: v?.sku);
  late final _title = TextEditingController(text: v?.title);
  late final _mrp = TextEditingController(text: v == null ? '' : rupeesInput(v!.mrpPaise));
  late final _price = TextEditingController(text: v == null ? '' : rupeesInput(v!.pricePaise));
  late final _stock = TextEditingController(text: '${v?.stock ?? 0}');
  late final _weight = TextEditingController(text: v?.weightGrams?.toString() ?? '');
  late int _gst = v?.gstRateBps ?? 1800;
  late bool _active = v?.isActive ?? true;
  String? _error;

  @override
  void dispose() {
    for (final c in [_sku, _title, _mrp, _price, _stock, _weight]) {
      c.dispose();
    }
    super.dispose();
  }

  void _done() {
    final sku = _sku.text.trim().toUpperCase();
    final mrp = paiseFrom(_mrp.text);
    final price = paiseFrom(_price.text);
    final stock = int.tryParse(_stock.text.trim());
    final weight = _weight.text.trim().isEmpty ? null : int.tryParse(_weight.text.trim());
    String? error;
    if (!RegExp(r'^[A-Z0-9][A-Z0-9._-]{0,39}$').hasMatch(sku)) {
      error = 'SKU: letters, numbers, dot, dash or underscore (max 40).';
    } else if (widget.takenSkus.contains(sku)) {
      error = 'Another variant already uses this SKU.';
    } else if (_title.text.trim().isEmpty) {
      error = 'Name the variant, e.g. “500 g” or “Large”.';
    } else if (mrp == null || mrp < 100) {
      error = 'Enter the MRP in rupees.';
    } else if (price == null || price < 100) {
      error = 'Enter your selling price in rupees.';
    } else if (price > mrp) {
      error = 'The selling price can’t be above the MRP.';
    } else if (stock == null) {
      error = 'Enter how many units you have.';
    } else if (_weight.text.trim().isNotEmpty && (weight == null || weight < 1)) {
      error = 'Weight is in grams, e.g. 500.';
    }
    if (error != null) return setState(() => _error = error);
    Navigator.pop(
      context,
      Variant(id: v?.id, sku: sku, title: _title.text.trim(), mrpPaise: mrp!, pricePaise: price!, gstRateBps: _gst, stock: stock!, weightGrams: weight, isActive: _active, inventoryStatus: v?.inventoryStatus),
    );
  }

  @override
  Widget build(BuildContext context) {
    final money = [FilteringTextInputFormatter.allow(RegExp(r'[\d.,]'))];
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(v == null ? 'New variant' : 'Edit variant', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(controller: _title, decoration: const InputDecoration(labelText: 'Size / weight / colour'))),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _sku,
                enabled: v?.id == null, // the SKU identifies a saved variant
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'SKU'),
              ),
            ),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(controller: _mrp, keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: money, decoration: const InputDecoration(labelText: 'MRP', prefixText: '₹'))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _price, keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: money, decoration: const InputDecoration(labelText: 'Selling price', prefixText: '₹'))),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                value: _gst,
                decoration: const InputDecoration(labelText: 'GST (included)'),
                items: [
                  for (final e in gstRates.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
                  // Keep a rate set elsewhere selectable rather than failing the dropdown.
                  if (!gstRates.containsKey(_gst)) DropdownMenuItem(value: _gst, child: Text(percent(_gst))),
                ],
                onChanged: (x) => setState(() => _gst = x ?? _gst),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _stock,
                // A saved variant's stock moves with orders; it's changed with "Update stock" so a stale form can't overwrite it.
                enabled: v?.id == null,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(labelText: v?.id == null ? 'Opening stock' : 'Stock', helperText: v?.id == null ? null : 'Use “Update stock”'),
              ),
            ),
          ]),
          const SizedBox(height: 12),
          TextField(controller: _weight, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: const InputDecoration(labelText: 'Packed weight in grams (optional)', helperText: 'Used for shipping')),
          SwitchListTile(contentPadding: EdgeInsets.zero, value: _active, onChanged: (x) => setState(() => _active = x), title: const Text('On sale'), subtitle: const Text('Turn off to stop selling this variant')),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: Brand.heart))),
          FilledButton(onPressed: _done, child: const Text('Done')),
          const SizedBox(height: 4),
          const Text('Changes are saved when you save the product.', textAlign: TextAlign.center, style: TextStyle(color: Brand.muted, fontSize: 12)),
        ]),
      ),
    );
  }
}
