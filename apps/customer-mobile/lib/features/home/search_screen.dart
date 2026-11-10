import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../contests/contest_screens.dart' show rupees;
import 'place.dart';
import 'search_logic.dart';

/// The word after "#", or the whole query when it is a single word: what hashtag to offer.
String? hashtagFor(String q) {
  final t = q.trim().replaceFirst(RegExp(r'^#'), '').toLowerCase();
  return RegExp(r'^[\p{L}\p{N}_]{2,50}$', unicode: true).hasMatch(t) ? t : null;
}

final searchFiltersProvider = FutureProvider.autoDispose<SearchFilters>((ref) => ref.watch(apiProvider).searchFilters());

/// Searches done this session, newest first.
final recentSearchesProvider = StateProvider<List<String>>((_) => const []);

/// Global search (spec §43): pets, people, reels, products, services, businesses, contests and challenges,
/// with filters that fit each kind.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key, this.initialQuery});
  final String? initialQuery;
  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  late final _q = TextEditingController(text: widget.initialQuery ?? '');
  Timer? _wait;
  String _query = '';
  String _type = 'all';
  Future<SearchAll>? _all;

  @override
  void initState() {
    super.initState();
    if ((widget.initialQuery ?? '').trim().length >= 2) _run(widget.initialQuery!);
  }

  @override
  void dispose() {
    _wait?.cancel();
    _q.dispose();
    super.dispose();
  }

  void _changed(String v) {
    _wait?.cancel();
    _wait = Timer(const Duration(milliseconds: 350), () => _run(v));
  }

  void _run(String v) {
    final q = v.trim();
    final place = ref.read(searchPlaceProvider);
    setState(() {
      _query = q;
      _all = q.length >= 2 ? ref.read(apiProvider).searchAll(q, lat: place?.at.lat, lng: place?.at.lng) : null;
    });
  }

  void _remember() => ref.read(recentSearchesProvider.notifier).state = addRecent(ref.read(recentSearchesProvider), _query);

  void _open(SearchHit h) {
    final to = hitRoute(h.linkKind, h.linkKey);
    if (to == null) return;
    _remember();
    context.push(to);
  }

  @override
  Widget build(BuildContext context) {
    final types = ref.watch(searchFiltersProvider).valueOrNull?.types ?? const <String>[];
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _q,
          autofocus: widget.initialQuery == null,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(hintText: 'Pets, people, shop, services, contests…', border: InputBorder.none, filled: false),
          onChanged: _changed,
          onSubmitted: (v) {
            _run(v);
            _remember();
          },
        ),
      ),
      body: Column(children: [
        SizedBox(
          height: 48,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), children: [
            for (final t in ['all', ...searchTypeOrder.where(types.contains)])
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(label: Text(t == 'all' ? 'All' : searchTypeLabel(t)), selected: _type == t, onSelected: (_) => setState(() => _type = t)),
              ),
          ]),
        ),
        const Divider(height: 1),
        Expanded(child: _query.length < 2 ? _start() : (_type == 'all' ? _allResults() : _TypeResults(key: ValueKey('$_type|$_query'), type: _type, query: _query, onOpen: _open))),
      ]),
    );
  }

  Widget _start() {
    final recent = ref.watch(recentSearchesProvider);
    if (recent.isEmpty) return const EmptyView(title: 'Search PetApp', message: 'Find pets and people, reels by #hashtag, things for your pet, services near you, contests and challenges.');
    return ListView(children: [
      const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text('Recent', style: TextStyle(fontWeight: FontWeight.w700))),
      for (final r in recent)
        ListTile(
          leading: const Icon(Icons.history, color: Brand.muted),
          title: Text(r),
          onTap: () {
            _q.text = r;
            _run(r);
          },
        ),
    ]);
  }

  Widget _allResults() {
    final tag = hashtagFor(_query);
    return FutureBuilder<SearchAll>(
      future: _all,
      builder: (ctx, snap) {
        if (snap.connectionState != ConnectionState.done) return const LoadingView();
        if (snap.hasError) return ErrorView(error: snap.error!, onRetry: () => _run(_query));
        final groups = snap.data?.groups ?? const <SearchGroup>[];
        return ListView(children: [
          if (tag != null && ref.watch(socialEnabledProvider))
            ListTile(
              leading: const CircleAvatar(backgroundColor: Color(0xFFDCEBE8), child: Text('#', style: TextStyle(color: Brand.teal, fontWeight: FontWeight.w700))),
              title: Text('#$tag'),
              subtitle: const Text('Posts with this hashtag'),
              onTap: () {
                _remember();
                context.push('/hashtag/$tag');
              },
            ),
          if (groups.isEmpty) const EmptyView(title: 'Nothing found', message: 'Try fewer words, or another spelling.'),
          for (final g in groups) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 8, 0),
              child: Row(children: [
                Expanded(child: Text(searchTypeLabel(g.type), style: const TextStyle(fontWeight: FontWeight.w700))),
                if (g.more) TextButton(onPressed: () => setState(() => _type = g.type), child: const Text('See all')),
              ]),
            ),
            for (final h in g.items) HitTile(hit: h, onTap: () => _open(h)),
          ],
        ]);
      },
    );
  }
}

/// One kind of result, with its filters, loading more as you scroll.
class _TypeResults extends ConsumerStatefulWidget {
  const _TypeResults({super.key, required this.type, required this.query, required this.onOpen});
  final String type;
  final String query;
  final void Function(SearchHit) onOpen;
  @override
  ConsumerState<_TypeResults> createState() => _TypeResultsState();
}

class _TypeResultsState extends ConsumerState<_TypeResults> {
  final _items = <SearchHit>[];
  String? _speciesId;
  String? _categoryId;
  String? _mode;
  String? _when;
  bool _inStock = false;
  bool _near = false;
  int _page = 1;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _near = filtersOf(widget.type).contains('near') && ref.read(searchPlaceProvider) != null;
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading || (!reset && !_more)) return;
    setState(() {
      _loading = true;
      _error = null;
      if (reset) {
        _items.clear();
        _page = 1;
        _more = true;
      }
    });
    try {
      final place = _near ? ref.read(searchPlaceProvider) : null;
      final filters = filterQuery(widget.type, speciesId: _speciesId, categoryId: _categoryId, mode: _mode, when: _when, inStock: _inStock, lat: place?.at.lat, lng: place?.at.lng);
      final (items, more) = await ref.read(apiProvider).searchType(widget.type, widget.query, page: _page, filters: filters);
      if (!mounted) return;
      setState(() {
        _items.addAll(items);
        _more = more;
        _page++;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _choose(String title, List<FilterOption> options, String? current, void Function(String?) set) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text(title, style: Theme.of(ctx).textTheme.titleMedium)),
          ListTile(title: const Text('Any'), trailing: current == null ? const Icon(Icons.check) : null, onTap: () => Navigator.pop(ctx, '')),
          for (final o in options) ListTile(title: Text(o.name), trailing: current == o.id ? const Icon(Icons.check) : null, onTap: () => Navigator.pop(ctx, o.id)),
        ]),
      ),
    );
    if (picked == null) return;
    set(picked.isEmpty ? null : picked);
    await _load(reset: true);
  }

  String _label(String any, List<FilterOption> options, String? id) => id == null ? any : options.firstWhere((o) => o.id == id, orElse: () => FilterOption(id, any)).name;

  @override
  Widget build(BuildContext context) {
    final f = ref.watch(searchFiltersProvider).valueOrNull;
    final has = filtersOf(widget.type);
    final categories = switch (widget.type) {
      'products' => f?.productCategories,
      'services' || 'partners' => f?.serviceCategories,
      'contests' => f?.contestCategories,
      _ => null,
    } ?? const <FilterOption>[];
    final whenOptions = widget.type == 'contests' ? f?.contestWhen ?? const <FilterOption>[] : f?.challengeWhen ?? const <FilterOption>[];
    final chips = <Widget>[
      if (has.contains('species') && (f?.species.isNotEmpty ?? false))
        ActionChip(label: Text(_label('Any animal', f!.species, _speciesId)), avatar: const Icon(Icons.pets, size: 16), onPressed: () => _choose('Animal', f.species, _speciesId, (v) => _speciesId = v)),
      if (has.contains('category') && categories.isNotEmpty)
        ActionChip(label: Text(_label('Any category', categories, _categoryId)), avatar: const Icon(Icons.category_outlined, size: 16), onPressed: () => _choose('Category', categories, _categoryId, (v) => _categoryId = v)),
      if (has.contains('mode') && (f?.serviceModes.isNotEmpty ?? false))
        ActionChip(label: Text(_label('Anywhere', f!.serviceModes, _mode)), avatar: const Icon(Icons.home_outlined, size: 16), onPressed: () => _choose('Where', f.serviceModes, _mode, (v) => _mode = v)),
      if (has.contains('when') && whenOptions.isNotEmpty)
        ActionChip(label: Text(_label('Any time', whenOptions, _when)), avatar: const Icon(Icons.schedule, size: 16), onPressed: () => _choose('When', whenOptions, _when, (v) => _when = v)),
      if (has.contains('inStock'))
        FilterChip(label: const Text('In stock'), selected: _inStock, onSelected: (v) {
          _inStock = v;
          _load(reset: true);
        }),
      if (has.contains('near'))
        FilterChip(label: Text(ref.watch(searchPlaceProvider)?.label ?? 'Near me'), avatar: const Icon(Icons.place_outlined, size: 16), selected: _near, onSelected: (v) async {
          if (v && ref.read(searchPlaceProvider) == null && !await pickPlace(context, ref)) return;
          _near = v;
          await _load(reset: true);
        }),
    ];
    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n.metrics.pixels > n.metrics.maxScrollExtent - 400) _load();
        return false;
      },
      child: ListView(children: [
        if (chips.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 0), child: Wrap(spacing: 6, runSpacing: 6, children: chips)),
        for (final h in _items) HitTile(hit: h, onTap: () => widget.onOpen(h)),
        if (_error != null) ErrorView(error: _error!, onRetry: () => _load(reset: _items.isEmpty)),
        if (_loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
        if (!_loading && _error == null && _items.isEmpty) const EmptyView(title: 'Nothing found', message: 'Try fewer words, or change the filters.'),
      ]),
    );
  }
}

/// A search result row.
class HitTile extends StatelessWidget {
  const HitTile({super.key, required this.hit, required this.onTap});
  final SearchHit hit;
  final VoidCallback onTap;

  IconData get _icon => switch (hit.type) {
        'PET' => Icons.pets,
        'USER' => Icons.person_outline,
        'REEL' => Icons.play_circle_outline,
        'PRODUCT' => Icons.shopping_bag_outlined,
        'SERVICE' || 'PARTNER' => Icons.storefront_outlined,
        'CONTEST' => Icons.emoji_events_outlined,
        'CHALLENGE' => Icons.flag_outlined,
        _ => Icons.search,
      };

  @override
  Widget build(BuildContext context) {
    final round = hit.type == 'PET' || hit.type == 'USER';
    final trailing = hitTrailing(hit.type, hit.meta, rupees);
    final Widget leading = round
        ? Avatar(url: hit.imageUrl, name: hit.title, size: 44)
        : ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 44,
              height: 44,
              child: hit.imageUrl == null ? Container(color: Brand.line, child: Icon(_icon, color: Brand.muted)) : CachedNetworkImage(imageUrl: hit.imageUrl!, fit: BoxFit.cover),
            ),
          );
    return ListTile(
      leading: leading,
      title: Text(hit.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: hit.subtitle == null ? null : Text(hit.subtitle!, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: trailing == null || trailing.isEmpty ? null : Text(trailing, style: const TextStyle(color: Brand.muted, fontSize: 12)),
      onTap: onTap,
    );
  }
}
