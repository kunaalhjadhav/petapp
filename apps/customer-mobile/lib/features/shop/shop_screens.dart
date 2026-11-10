import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../chat/chat_screens.dart';
import '../../config_share.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/payment_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../../common/share_button.dart';
import '../contests/contest_screens.dart' show rupees;
import '../reviews/review_widgets.dart';
import '../reviews/reviews_logic.dart';
import '../safety/report_screen.dart';

final shopCategoriesProvider = FutureProvider.autoDispose<List<ShopCategory>>((ref) => ref.watch(apiProvider).shopCategories());
final cartProvider = FutureProvider.autoDispose<Cart>((ref) => ref.watch(apiProvider).cart());
final _productProvider = FutureProvider.autoDispose.family<ProductDetail, String>((ref, id) => ref.watch(apiProvider).product(id));
final _ordersProvider = FutureProvider.autoDispose<List<ShopOrderSummary>>((ref) => ref.watch(apiProvider).shopOrders());
final _orderProvider = FutureProvider.autoDispose.family<ShopOrder, String>((ref, id) => ref.watch(apiProvider).shopOrder(id));

const parcelLabels = {
  'PENDING_PAYMENT': 'Awaiting payment',
  'CONFIRMED': 'Confirmed',
  'PACKED': 'Packed',
  'SHIPPED': 'Shipped',
  'DELIVERED': 'Delivered',
  'CANCELLED': 'Cancelled',
  'RETURN_REQUESTED': 'Return requested',
  'RETURNED': 'Returned',
};

/// Cart icon with a count, for app bars.
class CartButton extends ConsumerWidget {
  const CartButton({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final n = ref.watch(cartProvider).valueOrNull?.units ?? 0;
    return IconButton(
      tooltip: 'Cart',
      onPressed: () => context.push('/cart'),
      icon: Badge(isLabelVisible: n > 0, label: Text('$n'), child: const Icon(Icons.shopping_cart_outlined)),
    );
  }
}

class ShopScreen extends ConsumerStatefulWidget {
  const ShopScreen({super.key, this.vendorId, this.vendorName});

  /// Only this seller's products (from a partner offer on the home screen).
  final String? vendorId;
  final String? vendorName;
  @override
  ConsumerState<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends ConsumerState<ShopScreen> {
  final _search = TextEditingController();
  String? _categoryId;
  String _sort = 'relevance';
  late Future<List<ProductCard>> _results = _load();
  late final Future<List<Picked<ProductCard>>> _picks = ref.read(apiProvider).recommendedProducts().catchError((_) => <Picked<ProductCard>>[]);

  Future<List<ProductCard>> _load() => ref
      .read(apiProvider)
      .products(q: _search.text.trim().isEmpty ? null : _search.text.trim(), categoryId: _categoryId, vendorId: widget.vendorId, sort: _sort == 'relevance' ? null : _sort);

  /// Picks for their pets, above the full list when nothing is filtered.
  bool get _showPicks => _search.text.trim().isEmpty && _categoryId == null && widget.vendorId == null && _sort == 'relevance';

  void _reload() => setState(() => _results = _load());

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cats = ref.watch(shopCategoriesProvider).valueOrNull?.where((c) => c.parentId == null).toList() ?? const <ShopCategory>[];
    return Scaffold(
      appBar: AppBar(title: Text(widget.vendorName?.isNotEmpty == true ? widget.vendorName! : 'Shop'), actions: [
        IconButton(tooltip: 'My orders', icon: const Icon(Icons.receipt_long_outlined), onPressed: () => context.push('/orders')),
        const CartButton(),
      ]),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(hintText: 'Search food, toys, brands…', prefixIcon: const Icon(Icons.search), suffixIcon: PopupMenuButton<String>(
              tooltip: 'Sort',
              icon: const Icon(Icons.sort),
              initialValue: _sort,
              onSelected: (v) {
                _sort = v;
                _reload();
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'relevance', child: Text('Recommended')),
                PopupMenuItem(value: 'price_asc', child: Text('Price: low to high')),
                PopupMenuItem(value: 'price_desc', child: Text('Price: high to low')),
                PopupMenuItem(value: 'newest', child: Text('Newest')),
              ],
            )),
            onSubmitted: (_) => _reload(),
          ),
        ),
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8), children: [
            Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: ChoiceChip(label: const Text('All'), selected: _categoryId == null, onSelected: (_) {
              _categoryId = null;
              _reload();
            })),
            for (final c in cats)
              Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: ChoiceChip(label: Text(c.name), selected: _categoryId == c.id, onSelected: (_) {
                _categoryId = c.id;
                _reload();
              })),
          ]),
        ),
        Expanded(
          child: FutureBuilder<List<ProductCard>>(
            future: _results,
            builder: (ctx, snap) {
              if (snap.connectionState != ConnectionState.done) return const LoadingView();
              if (snap.hasError) return ErrorView(error: snap.error!, onRetry: _reload);
              final items = snap.data!;
              if (items.isEmpty) return const EmptyView(title: 'Nothing found', message: 'Try another search or category.');
              return RefreshIndicator(
                onRefresh: () async => _reload(),
                child: CustomScrollView(slivers: [
                  if (_showPicks) SliverToBoxAdapter(child: _Picks(future: _picks)),
                  SliverPadding(
                    padding: const EdgeInsets.all(12),
                    sliver: SliverGrid(
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: 12, crossAxisSpacing: 12, childAspectRatio: 0.66),
                      delegate: SliverChildBuilderDelegate((ctx, i) => _ProductTile(p: items[i]), childCount: items.length),
                    ),
                  ),
                ]),
              );
            },
          ),
        ),
      ]),
    );
  }
}

/// "Picked for your pets": recommended products with why each was picked.
class _Picks extends StatelessWidget {
  const _Picks({required this.future});
  final Future<List<Picked<ProductCard>>> future;
  @override
  Widget build(BuildContext context) => FutureBuilder<List<Picked<ProductCard>>>(
        future: future,
        builder: (ctx, snap) {
          final picks = snap.data ?? const [];
          if (picks.isEmpty) return const SizedBox.shrink();
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Padding(padding: EdgeInsets.fromLTRB(16, 12, 16, 8), child: Text('Picked for your pets', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
            SizedBox(
              height: 300,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                itemCount: picks.length,
                separatorBuilder: (_, __) => const SizedBox(width: 12),
                itemBuilder: (ctx, i) => SizedBox(
                  width: 160,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(child: _ProductTile(p: picks[i].item)),
                    if (picks[i].reason != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(picks[i].reason!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.teal, fontSize: 12, fontWeight: FontWeight.w600)),
                      ),
                  ]),
                ),
              ),
            ),
          ]);
        },
      );
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.p});
  final ProductCard p;
  @override
  Widget build(BuildContext context) {
    final url = p.image?.imageFor(400);
    return InkWell(
      onTap: () => context.push('/product/${p.id}'),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          AspectRatio(aspectRatio: 1, child: url == null ? Container(color: Brand.line) : CachedNetworkImage(imageUrl: url, fit: BoxFit.cover)),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Row(children: [
                Text(rupees(p.fromPaise), style: const TextStyle(fontWeight: FontWeight.w700)),
                if (p.offPct > 0) ...[
                  const SizedBox(width: 6),
                  Text('${p.offPct}% off', style: const TextStyle(color: Brand.teal, fontSize: 12, fontWeight: FontWeight.w600)),
                ],
              ]),
              if (p.ratingCount > 0) Text(ratingLine(p.ratingAvg, p.ratingCount), style: const TextStyle(color: Brand.muted, fontSize: 12)),
              if (!p.inStock) const Text('Out of stock', style: TextStyle(color: Brand.heart, fontSize: 12)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class ProductScreen extends ConsumerStatefulWidget {
  const ProductScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends ConsumerState<ProductScreen> {
  String? _variantId;
  int _qty = 1;
  bool _busy = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(actions: [
          if (ref.watch(chatEnabledProvider))
            if (ref.watch(_productProvider(widget.id)).valueOrNull case final p?)
              IconButton(tooltip: 'Ask the seller', icon: const Icon(Icons.chat_bubble_outline), onPressed: () => openChat(context, ref, productId: p.id)),
          if (ref.watch(_productProvider(widget.id)).valueOrNull case final p?) ShareButton(kind: ShareKind.product, linkKey: p.id, text: '${p.title} on PetApp'),
          const CartButton(),
          if (ref.watch(_productProvider(widget.id)).valueOrNull case final p?)
            PopupMenuButton<String>(
              tooltip: 'More',
              onSelected: (_) => reportContent(context, 'PRODUCT', p.id, 'product'),
              itemBuilder: (_) => const [PopupMenuItem(value: 'report', child: Text('Report this product'))],
            ),
        ]),
        body: ref.watch(_productProvider(widget.id)).when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_productProvider(widget.id))),
              data: (p) {
                final v = p.variants.firstWhere((x) => x.id == _variantId, orElse: () => p.variants.firstWhere((x) => x.inStock, orElse: () => p.variants.first));
                final w = MediaQuery.sizeOf(context).width * MediaQuery.devicePixelRatioOf(context);
                return ListView(children: [
                  if (p.images.isNotEmpty)
                    AspectRatio(
                      aspectRatio: 1,
                      child: PageView(children: [for (final m in p.images) if (m.imageFor(w) != null) CachedNetworkImage(imageUrl: m.imageFor(w)!, fit: BoxFit.cover)]),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (p.brand != null) Text(p.brand!, style: const TextStyle(color: Brand.muted)),
                      Text(p.title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                      if (p.ratingCount > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text(ratingLine(p.ratingAvg, p.ratingCount), style: const TextStyle(color: Brand.muted))),
                      const SizedBox(height: 8),
                      Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(rupees(v.pricePaise), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                        if (v.mrpPaise > v.pricePaise) ...[
                          const SizedBox(width: 8),
                          Text(rupees(v.mrpPaise), style: const TextStyle(color: Brand.muted, decoration: TextDecoration.lineThrough)),
                          const SizedBox(width: 8),
                          Text('${((v.mrpPaise - v.pricePaise) * 100 / v.mrpPaise).floor()}% off', style: const TextStyle(color: Brand.teal, fontWeight: FontWeight.w600)),
                        ],
                      ]),
                      const Text('Inclusive of all taxes', style: TextStyle(color: Brand.muted, fontSize: 12)),
                      const SizedBox(height: 16),
                      Wrap(spacing: 8, runSpacing: 8, children: [
                        for (final x in p.variants)
                          ChoiceChip(label: Text(x.inStock ? x.title : '${x.title} (out of stock)'), selected: x.id == v.id, onSelected: x.inStock ? (_) => setState(() {
                            _variantId = x.id;
                            _qty = 1;
                          }) : null),
                      ]),
                      if (v.lowStock != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Only ${v.lowStock} left', style: const TextStyle(color: Brand.heart))),
                      const SizedBox(height: 16),
                      Row(children: [
                        IconButton.outlined(onPressed: _qty > 1 ? () => setState(() => _qty--) : null, icon: const Icon(Icons.remove), tooltip: 'Fewer'),
                        Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('$_qty', style: const TextStyle(fontSize: 18))),
                        IconButton.outlined(onPressed: _qty < (v.lowStock ?? 10) ? () => setState(() => _qty++) : null, icon: const Icon(Icons.add), tooltip: 'More'),
                        const SizedBox(width: 16),
                        Expanded(
                          child: FilledButton(
                            onPressed: !v.inStock || _busy
                                ? null
                                : () async {
                                    setState(() => _busy = true);
                                    try {
                                      await ref.read(apiProvider).setCartItem(v.id, _qty);
                                      ref.invalidate(cartProvider);
                                      if (context.mounted) {
                                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                                          content: const Text('Added to cart'),
                                          action: SnackBarAction(label: 'View cart', onPressed: () => context.push('/cart')),
                                        ));
                                      }
                                    } catch (e) {
                                      if (context.mounted) showError(context, e);
                                    } finally {
                                      if (mounted) setState(() => _busy = false);
                                    }
                                  },
                            child: Text(v.inStock ? 'Add to cart' : 'Out of stock'),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 24),
                      Text(p.description),
                      const SizedBox(height: 16),
                      Text('Sold by ${p.vendorName}${p.vendorCity != null ? ', ${p.vendorCity}' : ''}', style: const TextStyle(color: Brand.muted)),
                      const SizedBox(height: 24),
                      ReviewsSection(subject: ReviewSubject.product, id: p.id, title: p.title, summary: p.ratingSummary, recent: p.reviews, count: p.ratingCount),
                    ]),
                  ),
                ]);
              },
            ),
      );
}

class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});
  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  final _coupon = TextEditingController();
  Cart? _priced; // with the coupon applied
  bool _busy = false;

  Future<void> _applyCoupon() async {
    try {
      final c = await ref.read(apiProvider).previewCheckout(_coupon.text.trim());
      setState(() => _priced = c);
      if (mounted && c.couponProblem != null) showMessage(context, c.couponProblem!);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _setQty(CartLine l, int qty) async {
    try {
      await ref.read(apiProvider).setCartItem(l.variantId, qty);
      ref.invalidate(cartProvider);
      if (_priced != null) await _applyCoupon();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<Address?> _pickAddress() async {
    final api = ref.read(apiProvider);
    final list = await api.addresses();
    if (!mounted) return null;
    return showModalBottomSheet<Address>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Deliver to', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
          for (final a in list)
            ListTile(leading: const Icon(Icons.home_outlined), title: Text(a.label ?? 'Address'), subtitle: Text(a.oneLine), onTap: () => Navigator.pop(ctx, a)),
          ListTile(
            leading: const Icon(Icons.add_location_alt_outlined, color: Brand.teal),
            title: const Text('Add a new address'),
            onTap: () async {
              final a = await showDialog<Address>(context: ctx, builder: (_) => const _AddressForm());
              if (a != null && ctx.mounted) Navigator.pop(ctx, a);
            },
          ),
        ]),
      ),
    );
  }

  /// Shipping and delivery time for this address (delivery zones), confirmed before the order is placed.
  Future<bool> _confirm(Cart cart, Address address) async {
    final Cart priced;
    try {
      priced = await ref.read(apiProvider).previewCheckout(cart.couponCode, addressId: address.id);
    } catch (e) {
      if (mounted) showError(context, e);
      return false;
    }
    if (!mounted) return false;
    final d = priced.delivery;
    if (d != null && !d.deliverable) {
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Can’t deliver here yet'),
          content: Text(d.problem ?? 'We don’t deliver to this address yet. Try another address.'),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
        ),
      );
      return false;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Deliver to ${address.label ?? 'this address'}?'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(address.oneLine),
          if (d?.line != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(d!.line!, style: const TextStyle(fontWeight: FontWeight.w600))),
          const SizedBox(height: 8),
          Text('Shipping ${priced.shippingPaise == 0 ? 'free' : rupees(priced.shippingPaise)} · total ${rupees(priced.totalPaise)}'),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text('Pay ${rupees(priced.totalPaise)}')),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _checkout(Cart cart) async {
    final address = await _pickAddress();
    if (address == null) return;
    if (!await _confirm(cart, address)) return;
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      final placed = await api.placeOrder(address.id, couponCode: cart.couponCode);
      ref.invalidate(cartProvider);
      try {
        await PaymentService(api).pay(placed.payment, description: 'Order ${placed.order.code}');
        if (mounted) showMessage(context, 'Order placed!');
      } on PaymentCancelled catch (e) {
        if (mounted) showMessage(context, '${e.message} You can pay from the order page.');
      } on PaymentPending catch (e) {
        if (mounted) showMessage(context, e.message);
      }
      if (mounted) context.pushReplacement('/order/${placed.order.id}');
    } catch (e) {
      ref.invalidate(cartProvider); // e.g. something just sold out: show the updated cart
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _coupon.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Cart')),
        body: ref.watch(cartProvider).when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(cartProvider)),
              data: (base) {
                if (base.items.isEmpty) return EmptyView(title: 'Your cart is empty', action: OutlinedButton(onPressed: () => context.go('/shop'), child: const Text('Go shopping')));
                final c = _priced != null && _priced!.items.length == base.items.length ? _priced! : base;
                Widget row(String l, int p, {bool bold = false, bool minus = false}) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(children: [
                        Expanded(child: Text(l, style: TextStyle(fontWeight: bold ? FontWeight.w700 : null))),
                        Text(p == 0 && l == 'Shipping' ? 'Free' : '${minus ? '−' : ''}${rupees(p)}', style: TextStyle(fontWeight: bold ? FontWeight.w700 : null, color: minus ? Brand.teal : null)),
                      ]),
                    );
                return ListView(padding: const EdgeInsets.all(16), children: [
                  for (final l in base.items)
                    Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: l.problem != null ? Brand.heart : Brand.line)),
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          SizedBox(width: 64, height: 64, child: l.image?.imageFor(200) == null ? Container(color: Brand.line) : CachedNetworkImage(imageUrl: l.image!.imageFor(200)!, fit: BoxFit.cover)),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(l.productTitle, style: const TextStyle(fontWeight: FontWeight.w600)),
                              Text('${l.variantTitle} · ${l.vendorName}', style: const TextStyle(color: Brand.muted, fontSize: 12)),
                              Text(rupees(l.unitPricePaise * l.qty), style: const TextStyle(fontWeight: FontWeight.w700)),
                              if (l.problem != null) Text(l.problem!, style: const TextStyle(color: Brand.heart, fontSize: 12)),
                              Row(children: [
                                IconButton(onPressed: () => _setQty(l, l.qty - 1), icon: Icon(l.qty == 1 ? Icons.delete_outline : Icons.remove), tooltip: l.qty == 1 ? 'Remove' : 'Fewer'),
                                Text('${l.qty}'),
                                IconButton(onPressed: () => _setQty(l, l.qty + 1), icon: const Icon(Icons.add), tooltip: 'More'),
                              ]),
                            ]),
                          ),
                        ]),
                      ),
                    ),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(child: TextField(controller: _coupon, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Coupon code'))),
                    const SizedBox(width: 8),
                    OutlinedButton(onPressed: _applyCoupon, child: const Text('Apply')),
                  ]),
                  if (c.couponCode != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${c.couponCode} applied', style: const TextStyle(color: Brand.teal))),
                  const SizedBox(height: 16),
                  row('Items', c.itemsPaise),
                  if (c.discountPaise > 0) row('Coupon', c.discountPaise, minus: true),
                  row('Shipping', c.shippingPaise),
                  if (c.parcels.length > 1) Text('Ships in ${c.parcels.length} parcels (one per seller).', style: const TextStyle(color: Brand.muted, fontSize: 12)),
                  const Divider(),
                  row('Total', c.totalPaise, bold: true),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: !c.canCheckout || _busy ? null : () => _checkout(c), child: Text(_busy ? 'Placing order…' : 'Checkout · ${rupees(c.totalPaise)}')),
                  if (!c.canCheckout) const Padding(padding: EdgeInsets.only(top: 8), child: Text('Fix the items marked in red to continue.', style: TextStyle(color: Brand.heart))),
                ]);
              },
            ),
      );
}

class _AddressForm extends ConsumerStatefulWidget {
  const _AddressForm();
  @override
  ConsumerState<_AddressForm> createState() => _AddressFormState();
}

class _AddressFormState extends ConsumerState<_AddressForm> {
  final _f = {for (final k in ['label', 'line1', 'locality', 'city', 'state', 'pincode']) k: TextEditingController()};
  bool _busy = false;
  String? _looked;
  String? _pinNote;

  /// Fills in the city, state and area from the PIN code when PetApp knows it (fields already typed are kept).
  Future<void> _pinChanged(String v) async {
    final pin = v.replaceAll(' ', '');
    if (!RegExp(r'^[1-9]\d{5}$').hasMatch(pin) || pin == _looked) return;
    _looked = pin;
    try {
      final info = await ref.read(apiProvider).pincode(pin);
      if (!mounted) return;
      setState(() {
        if (_f['city']!.text.trim().isEmpty) _f['city']!.text = info.city;
        if (_f['state']!.text.trim().isEmpty) _f['state']!.text = info.stateName;
        if (_f['locality']!.text.trim().isEmpty && info.locality != null) _f['locality']!.text = info.locality!;
        _pinNote = [info.locality, info.city].whereType<String>().join(', ');
      });
    } catch (_) {
      if (mounted) setState(() => _pinNote = null); // unknown PIN codes are fine: type the city
    }
  }

  @override
  void dispose() {
    for (final c in _f.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Widget field(String k, String label, {TextInputType? type}) => TextField(controller: _f[k], keyboardType: type, decoration: InputDecoration(labelText: label));
    return AlertDialog(
      title: const Text('New address'),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(
            controller: _f['pincode'],
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: InputDecoration(labelText: 'PIN code', helperText: _pinNote, counterText: ''),
            onChanged: _pinChanged,
          ),
          field('label', 'Label (Home, Work)'),
          field('line1', 'House, street'),
          field('locality', 'Area or locality'),
          field('city', 'City'),
          field('state', 'State'),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(
          onPressed: _busy
              ? null
              : () async {
                  final v = {for (final e in _f.entries) e.key: e.value.text.trim()};
                  if (v['line1']!.isEmpty || v['city']!.isEmpty || v['state']!.isEmpty || !RegExp(r'^[1-9]\d{5}$').hasMatch(v['pincode']!)) {
                    return showMessage(context, 'Fill in the address, city, state and a 6-digit PIN code.');
                  }
                  setState(() => _busy = true);
                  try {
                    final a = await ref.read(apiProvider).addAddress({...v..removeWhere((_, x) => x.isEmpty)});
                    if (context.mounted) Navigator.pop(context, a);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: const Text('Save'),
        ),
      ],
    );
  }
}

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('My orders')),
        body: ref.watch(_ordersProvider).when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_ordersProvider)),
              data: (list) => list.isEmpty
                  ? const EmptyView(title: 'No orders yet')
                  : RefreshIndicator(
                      onRefresh: () async => ref.invalidate(_ordersProvider),
                      child: ListView(children: [
                        for (final o in list)
                          ListTile(
                            title: Text('Order ${o.code}'),
                            subtitle: Text('${o.units} item${o.units == 1 ? '' : 's'} · ${o.parcelStatuses.map((s) => parcelLabels[s] ?? s).toSet().join(', ')}${o.createdAt != null ? ' · ${ago(o.createdAt)}' : ''}'),
                            trailing: Text(rupees(o.totalPaise), style: const TextStyle(fontWeight: FontWeight.w700)),
                            onTap: () => context.push('/order/${o.id}'),
                          ),
                      ]),
                    ),
            ),
      );
}

class OrderScreen extends ConsumerWidget {
  const OrderScreen({super.key, required this.id});
  final String id;

  Future<String?> _reason(BuildContext context, String title, String hint) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(controller: ctrl, autofocus: true, maxLength: 500, decoration: InputDecoration(hintText: hint)),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back')), TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Confirm'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiProvider);
    Future<void> act(Future<ShopOrder> Function() f, String done) async {
      try {
        await f();
        ref.invalidate(_orderProvider(id));
        if (context.mounted) showMessage(context, done);
      } catch (e) {
        if (context.mounted) showError(context, e);
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Order')),
      body: ref.watch(_orderProvider(id)).when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_orderProvider(id))),
            data: (o) => RefreshIndicator(
              onRefresh: () async => ref.invalidate(_orderProvider(id)),
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Text('Order ${o.code}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                if (o.createdAt != null) Text('Placed ${ago(o.createdAt)}', style: const TextStyle(color: Brand.muted)),
                if (o.payment != null) ...[
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: () async {
                      try {
                        await PaymentService(api).pay(o.payment!, description: 'Order ${o.code}');
                        ref.invalidate(_orderProvider(id));
                      } on PaymentCancelled catch (e) {
                        if (context.mounted) showMessage(context, e.message);
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                    },
                    child: Text('Pay now · ${rupees(o.totalPaise)}'),
                  ),
                  const Text('Unpaid orders are released after 30 minutes.', style: TextStyle(color: Brand.muted, fontSize: 12)),
                ],
                for (final p in o.parcels)
                  Card(
                    elevation: 0,
                    margin: const EdgeInsets.only(top: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Brand.line)),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(p.vendorName, style: const TextStyle(fontWeight: FontWeight.w700))),
                          Text(parcelLabels[p.status] ?? p.status, style: TextStyle(color: p.status == 'CANCELLED' ? Brand.heart : Brand.teal, fontWeight: FontWeight.w600)),
                        ]),
                        for (final i in p.items)
                          Row(children: [
                            Expanded(child: Text('${i.qty} × ${i.productTitle} (${i.variantTitle})')),
                            if (i.reviewRating != null)
                              Semantics(label: 'You rated it ${i.reviewRating} out of 5', excludeSemantics: true, child: Text(starsText(i.reviewRating!), style: TextStyle(color: Colors.amber.shade800, fontSize: 13)))
                            else if (i.canReview && i.productId != null)
                              TextButton(
                                onPressed: () async {
                                  final posted = await writeReview(
                                    context,
                                    title: 'Review this product',
                                    subtitle: '${i.productTitle} (${i.variantTitle}), from ${p.vendorName}',
                                    submit: (rating, comment, photoIds) => api.reviewProduct(i.productId!, rating, comment: comment, photoIds: photoIds),
                                  );
                                  if (posted) {
                                    ref.invalidate(_orderProvider(id));
                                    ref.invalidate(_productProvider(i.productId!));
                                  }
                                },
                                child: const Text('Write a review'),
                              ),
                          ]),
                        if (p.trackingNumber != null) Text('${p.courier ?? 'Courier'} · tracking ${p.trackingNumber}', style: const TextStyle(color: Brand.muted)),
                        if (p.cancelReason != null) Text('Cancelled${p.cancelledBy == 'VENDOR' ? ' by the seller' : ''}: ${p.cancelReason}', style: const TextStyle(color: Brand.muted)),
                        if (p.returnStatus != null)
                          Text(
                            switch (p.returnStatus) {
                              'REQUESTED' => 'Return requested. The seller will reply soon.',
                              'APPROVED' => 'Return approved. Hand the parcel to the courier.',
                              'REJECTED' => 'Return not accepted${p.returnNote != null ? ': ${p.returnNote}' : ''}.',
                              _ => 'Return received. ${p.returnRefundPaise != null ? '${rupees(p.returnRefundPaise!)} is being refunded.' : ''}',
                            },
                            style: const TextStyle(color: Brand.muted),
                          ),
                        Text('Parcel total ${rupees(p.totalPaise)}', style: const TextStyle(color: Brand.muted, fontSize: 12)),
                        Wrap(spacing: 8, children: [
                          if (p.canCancel)
                            TextButton(
                              onPressed: () async {
                                final r = await _reason(context, 'Cancel this parcel?', 'Why are you cancelling?');
                                if (r != null && r.length >= 3) await act(() => api.cancelParcel(p.id, r), 'Cancelled. ${rupees(p.totalPaise)} will be refunded.');
                              },
                              child: const Text('Cancel', style: TextStyle(color: Brand.heart)),
                            ),
                          if (p.canReturn)
                            TextButton(
                              onPressed: () async {
                                final r = await _reason(context, 'Return this parcel?', 'What’s wrong?');
                                if (r != null && r.length >= 3) await act(() => api.returnParcel(p.id, r), 'Return requested.');
                              },
                              child: const Text('Return'),
                            ),
                          if (ref.watch(chatEnabledProvider)) TextButton(onPressed: () => openChat(context, ref, subOrderId: p.id), child: const Text('Message seller')),
                          TextButton(
                            onPressed: () => context.push('/help/new?ref=ORDER&refId=${p.id}&label=${Uri.encodeComponent('order ${p.code}')}'),
                            child: const Text('Get help'),
                          ),
                        ]),
                      ]),
                    ),
                  ),
                const SizedBox(height: 16),
                for (final x in [('Items', o.itemsPaise, false), if (o.discountPaise > 0) ('Coupon', -o.discountPaise, false), ('Shipping', o.shippingPaise, false), ('Total paid', o.totalPaise, true)])
                  Row(children: [Expanded(child: Text(x.$1, style: TextStyle(fontWeight: x.$3 ? FontWeight.w700 : null))), Text(x.$2 < 0 ? '−${rupees(-x.$2)}' : rupees(x.$2), style: TextStyle(fontWeight: x.$3 ? FontWeight.w700 : null))]),
                for (final r in o.refunds)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('Refund ${rupees(r.amountPaise)}: ${r.status == 'PROCESSED' ? 'sent to your payment method' : 'being processed'}', style: const TextStyle(color: Brand.teal)),
                  ),
              ]),
            ),
          ),
    );
  }
}
