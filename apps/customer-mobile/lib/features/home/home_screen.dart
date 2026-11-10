import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/api_client.dart';
import '../../api/models.dart';
import '../../common/money_text.dart' show dateTime, shortDate;
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../contests/contest_screens.dart' show rupees;
import '../posts/post_card.dart';
import 'place.dart';

/// The Home tab: place, search and alerts at the top; then the sections admins arrange (each filled
/// for this person); then posts from people they follow (or Discover).
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  FeedKind _kind = FeedKind.following;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => locateOnce(ref));
  }

  @override
  Widget build(BuildContext context) {
    final place = ref.watch(searchPlaceProvider);
    final home = ref.watch(homeProvider);
    final feed = ref.watch(feedProvider(_kind));
    final ctrl = ref.read(feedProvider(_kind).notifier);
    final unread = ref.watch(unreadCountProvider).valueOrNull ?? 0;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 4,
        title: TextButton.icon(
          onPressed: () => pickPlace(context, ref),
          icon: const Icon(Icons.place_outlined, size: 20),
          label: Row(mainAxisSize: MainAxisSize.min, children: [
            Flexible(child: Text(place?.label ?? 'Choose where', overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
            const Icon(Icons.expand_more, size: 20),
          ]),
        ),
        actions: [
          if (ref.watch(assistantEnabledProvider))
            IconButton(tooltip: 'PetApp Assistant', icon: const Icon(Icons.auto_awesome_outlined), onPressed: () => context.push('/assistant')),
          IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: () => context.push('/search')),
          IconButton(
            tooltip: 'Notifications',
            icon: Badge(isLabelVisible: unread > 0, label: Text(unread > 99 ? '99+' : '$unread'), child: const Icon(Icons.notifications_none_rounded)),
            onPressed: () => context.go('/alerts'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(homeProvider);
          ref.read(dismissedProvider.notifier).state = const {};
          await ctrl.refresh();
        },
        child: CustomScrollView(slivers: [
          const SliverToBoxAdapter(child: _Shortcuts()),
          ...home.when(
            loading: () => [const SliverToBoxAdapter(child: LoadingView())],
            error: (e, _) => [
              SliverToBoxAdapter(
                child: ListTile(
                  leading: const Icon(Icons.cloud_off_outlined, color: Brand.muted),
                  title: Text(ApiException.from(e).message),
                  trailing: TextButton(onPressed: () => ref.invalidate(homeProvider), child: const Text('Retry')),
                ),
              ),
            ],
            data: (h) => [for (final s in h.sections) SliverToBoxAdapter(child: HomeSectionWidget(key: ValueKey(s.id), section: s))],
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
              child: Row(children: [
                const Expanded(child: Text('Posts', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 17))),
                SegmentedButton<FeedKind>(
                  segments: const [ButtonSegment(value: FeedKind.following, label: Text('Following')), ButtonSegment(value: FeedKind.discover, label: Text('Discover'))],
                  selected: {_kind},
                  showSelectedIcon: false,
                  onSelectionChanged: (s) => setState(() => _kind = s.first),
                ),
              ]),
            ),
          ),
          if (!feed.loadedOnce)
            const SliverToBoxAdapter(child: LoadingView())
          else if (feed.items.isEmpty && feed.error != null)
            SliverToBoxAdapter(child: ErrorView(error: feed.error!, onRetry: ctrl.refresh))
          else if (feed.items.isEmpty)
            SliverToBoxAdapter(
              child: _kind == FeedKind.following
                  ? EmptyView(
                      title: 'Your feed is quiet',
                      message: 'Follow people and pets to see their posts here.',
                      action: OutlinedButton(onPressed: () => setState(() => _kind = FeedKind.discover), child: const Text('Discover posts')),
                    )
                  : const EmptyView(title: 'Nothing to discover yet', message: 'Be the first to post!'),
            )
          else
            SliverList(
              delegate: SliverChildBuilderDelegate((ctx, i) {
                if (i >= feed.items.length - 3) ctrl.loadMoreSoon();
                if (i == feed.items.length) {
                  if (feed.error != null) return ErrorView(error: feed.error!, onRetry: ctrl.loadMore);
                  return feed.done ? const SizedBox(height: 32) : const LoadingView();
                }
                final p = feed.items[i];
                return PostCard(key: ValueKey(p.id), post: p, onRemoved: () => ctrl.removeWhere((x) => x.id == p.id));
              }, childCount: feed.items.length + 1),
            ),
        ]),
      ),
    );
  }
}

/// Quick ways into the parts of the app that are switched on.
class _Shortcuts extends ConsumerWidget {
  const _Shortcuts();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final links = [
      (Icons.pets, 'Discover pets', '/discover'),
      if (ref.watch(shopEnabledProvider)) (Icons.shopping_bag_outlined, 'Shop', '/shop'),
      if (ref.watch(servicesEnabledProvider)) (Icons.storefront_outlined, 'Services', '/services'),
      if (ref.watch(contestsEnabledProvider)) (Icons.emoji_events_outlined, 'Contests', '/contests'),
      if (ref.watch(contestsEnabledProvider)) (Icons.local_fire_department_outlined, 'Challenges', '/challenges'),
    ];
    return SizedBox(
      height: 52,
      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(12, 8, 12, 4), children: [
        for (final (icon, label, to) in links)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 4), child: ActionChip(avatar: Icon(icon, size: 18), label: Text(label), onPressed: () => context.push(to))),
      ]),
    );
  }
}

String _idOf(Object o) => switch (o) {
      Post p => p.id,
      Pet p => p.id,
      ContestCard c => c.id,
      ChallengeCard c => c.id,
      NearbyPartner p => p.id,
      ProductCard p => p.id,
      HomeOffer c => c.id,
      UpcomingItem u => u.id,
      _ => '',
    };

/// One home section: a title, "See all" where there is a full list, and its items.
class HomeSectionWidget extends ConsumerWidget {
  const HomeSectionWidget({super.key, required this.section});
  final HomeSectionView section;

  String? get _seeAll => switch (section.kind) {
        'FEATURED_REELS' => '/reels',
        'ACTIVE_CONTESTS' => '/contests',
        'CHALLENGES' => '/challenges',
        'NEARBY_SERVICES' => '/services',
        'RECOMMENDED_PRODUCTS' => '/shop',
        _ => null,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hidden = ref.watch(dismissedProvider);
    final items = section.items.where((p) => !hidden.contains(_idOf(p.item))).toList();
    if (items.isEmpty) return const SizedBox.shrink();
    final seeAll = _seeAll;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 8, 8),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(section.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
              if (section.subtitle != null) Text(section.subtitle!, style: const TextStyle(color: Brand.muted, fontSize: 13)),
            ]),
          ),
          if (seeAll != null)
            TextButton(
              // Reels is a tab: switch to it rather than stacking a copy.
              onPressed: () {
                if (seeAll == '/reels') {
                  context.go(seeAll);
                } else {
                  context.push(seeAll);
                }
              },
              child: const Text('See all'),
            ),
        ]),
      ),
      if (section.kind == 'UPCOMING_EVENTS')
        Column(children: [for (final p in items) _UpcomingTile(item: p.item as UpcomingItem)])
      else
        SizedBox(
          height: _height(section.kind),
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (ctx, i) => _Dismissable(kind: section.kind, picked: items[i], child: _tile(items[i])),
          ),
        ),
    ]);
  }

  static double _height(String kind) => switch (kind) {
        'FEATURED_REELS' => 236,
        'TRENDING_PETS' => 136,
        'NEARBY_SERVICES' => 132,
        'PARTNER_OFFERS' => 132,
        'RECOMMENDED_PRODUCTS' => 254,
        _ => 214,
      };

  Widget _tile(Picked<Object> p) => switch (p.item) {
        Post x => _ReelTile(post: x, why: p.reason),
        Pet x => _PetTile(pet: x, why: p.reason),
        ContestCard x => _ContestTile(contest: x, why: p.reason),
        ChallengeCard x => _ChallengeTile(challenge: x, why: p.reason),
        NearbyPartner x => _PartnerTile(partner: x, why: p.reason),
        ProductCard x => _ProductTile(product: x, why: p.reason),
        HomeOffer x => _OfferTile(offer: x),
        _ => const SizedBox.shrink(),
      };
}

/// Long-press an item for "Not interested": it disappears and isn't recommended again.
class _Dismissable extends ConsumerWidget {
  const _Dismissable({required this.kind, required this.picked, required this.child});
  final String kind;
  final Picked<Object> picked;
  final Widget child;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final target = HomeSectionView.dismissTarget(kind);
    if (target == null || picked.pinned || ref.watch(authProvider).me == null) return child;
    return GestureDetector(
      onLongPress: () async {
        final ok = await showModalBottomSheet<bool>(
          context: context,
          showDragHandle: true,
          builder: (ctx) => SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                leading: const Icon(Icons.visibility_off_outlined),
                title: const Text('Not interested'),
                subtitle: const Text('We won’t recommend this again.'),
                onTap: () => Navigator.pop(ctx, true),
              ),
            ]),
          ),
        );
        if (ok != true) return;
        final id = _idOf(picked.item);
        ref.read(dismissedProvider.notifier).state = {...ref.read(dismissedProvider), id};
        try {
          await ref.read(apiProvider).notInterested(target, id);
        } catch (e) {
          ref.read(dismissedProvider.notifier).state = {...ref.read(dismissedProvider)}..remove(id);
          if (context.mounted) showError(context, e);
        }
      },
      child: child,
    );
  }
}

/// Why an item was picked, in small print.
class _Why extends StatelessWidget {
  const _Why(this.text);
  final String? text;
  @override
  Widget build(BuildContext context) => text == null
      ? const SizedBox.shrink()
      : Text(text!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.teal, fontSize: 12, fontWeight: FontWeight.w600));
}

BoxDecoration get _card => BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.line));

Widget _banner(String? url, IconData icon, double height) => SizedBox(
      height: height,
      width: double.infinity,
      child: url == null ? Container(color: const Color(0xFFDCEBE8), child: Icon(icon, color: Brand.teal, size: 32)) : CachedNetworkImage(imageUrl: url, fit: BoxFit.cover),
    );

class _ReelTile extends StatelessWidget {
  const _ReelTile({required this.post, this.why});
  final Post post;
  final String? why;
  @override
  Widget build(BuildContext context) {
    final m = post.media.isEmpty ? null : post.media.first;
    final url = m == null ? null : (m.isVideo ? m.poster : m.imageFor(320));
    return InkWell(
      onTap: () => context.push('/post/${post.id}'),
      borderRadius: BorderRadius.circular(12),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 132,
          child: Stack(fit: StackFit.expand, children: [
            url == null ? Container(color: Brand.line) : CachedNetworkImage(imageUrl: url, fit: BoxFit.cover),
            const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.center, end: Alignment.bottomCenter, colors: [Colors.transparent, Color(0xCC000000)]))),
            const Positioned(right: 6, top: 6, child: Icon(Icons.play_arrow_rounded, color: Colors.white)),
            Positioned(
              left: 8,
              right: 8,
              bottom: 8,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (why != null) Text(why!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Color(0xFFBFE3DE), fontSize: 11, fontWeight: FontWeight.w600)),
                Text(post.caption ?? post.author.name ?? '', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

class _PetTile extends StatelessWidget {
  const _PetTile({required this.pet, this.why});
  final Pet pet;
  final String? why;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () => context.push('/pet/${pet.handle}'),
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 96,
          child: Column(children: [
            Avatar(url: pet.avatarUrl, name: pet.name, size: 72),
            const SizedBox(height: 6),
            Text(pet.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(why ?? pet.speciesName, maxLines: 2, textAlign: TextAlign.center, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: why == null ? Brand.muted : Brand.teal)),
          ]),
        ),
      );
}

class _ContestTile extends StatelessWidget {
  const _ContestTile({required this.contest, this.why});
  final ContestCard contest;
  final String? why;
  @override
  Widget build(BuildContext context) {
    final c = contest;
    final closes = c.registrationOpen ? c.registrationClosesAt : c.votingClosesAt;
    return InkWell(
      onTap: () => context.push('/contest/${c.id}'),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 240,
        clipBehavior: Clip.antiAlias,
        decoration: _card,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _banner(c.bannerUrl, Icons.emoji_events_outlined, 110),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 2),
              Text(
                [c.isFree ? 'Free' : rupees(c.feePaise), if (closes != null) '${c.registrationOpen ? 'entries close' : 'voting closes'} ${shortDate(closes)}'].join(' · '),
                style: const TextStyle(color: Brand.muted, fontSize: 12),
              ),
              const SizedBox(height: 2),
              _Why(why),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _ChallengeTile extends StatelessWidget {
  const _ChallengeTile({required this.challenge, this.why});
  final ChallengeCard challenge;
  final String? why;
  @override
  Widget build(BuildContext context) {
    final c = challenge;
    final mine = c.mine;
    return InkWell(
      onTap: () => context.push('/challenge/${c.id}'),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 220,
        clipBehavior: Clip.antiAlias,
        decoration: _card,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _banner(c.bannerUrl, Icons.local_fire_department_outlined, 110),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 2),
              Text(
                mine != null ? '${mine.checkIns} of ${c.requiredCheckIns} check-ins' : '${c.participants} taking part',
                style: const TextStyle(color: Brand.muted, fontSize: 12),
              ),
              const SizedBox(height: 2),
              _Why(why),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _PartnerTile extends StatelessWidget {
  const _PartnerTile({required this.partner, this.why});
  final NearbyPartner partner;
  final String? why;
  @override
  Widget build(BuildContext context) {
    final p = partner;
    final where = [p.area, p.city].whereType<String>().where((s) => s.isNotEmpty).join(', ');
    return InkWell(
      onTap: () => context.push('/service-partner/${p.id}'),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 236,
        padding: const EdgeInsets.all(12),
        decoration: _card,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(p.businessName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (where.isNotEmpty) Text(where, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.muted, fontSize: 12)),
          const SizedBox(height: 6),
          Row(children: [
            if (p.ratingCount > 0) ...[
              const Icon(Icons.star_rounded, size: 16, color: Color(0xFFE0A100)),
              Text(' ${p.ratingAvg.toStringAsFixed(1)} (${p.ratingCount})', style: const TextStyle(fontSize: 12)),
              const SizedBox(width: 8),
            ],
            if (p.distanceKm > 0) Text('${p.distanceKm.toStringAsFixed(1)} km', style: const TextStyle(fontSize: 12)),
          ]),
          const Spacer(),
          Row(children: [
            Expanded(child: _Why(why)),
            Text('from ${rupees(p.fromPaise)}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          ]),
        ]),
      ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.product, this.why});
  final ProductCard product;
  final String? why;
  @override
  Widget build(BuildContext context) {
    final p = product;
    final url = p.image?.imageFor(320);
    return InkWell(
      onTap: () => context.push('/product/${p.id}'),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 152,
        clipBehavior: Clip.antiAlias,
        decoration: _card,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          AspectRatio(aspectRatio: 1, child: url == null ? Container(color: Brand.line) : CachedNetworkImage(imageUrl: url, fit: BoxFit.cover)),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              const SizedBox(height: 2),
              Row(children: [
                Text(rupees(p.fromPaise), style: const TextStyle(fontWeight: FontWeight.w700)),
                if (p.offPct > 0) Text('  ${p.offPct}% off', style: const TextStyle(color: Brand.teal, fontSize: 12)),
              ]),
              _Why(why),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// "10% off (up to ₹200)", "₹100 off".
String offerText(HomeOffer o) {
  // Percentages are in basis points (1000 = 10%).
  final pct = o.value % 100 == 0 ? '${o.value ~/ 100}' : (o.value / 100).toStringAsFixed(1);
  final off = o.kind == 'PERCENT' ? '$pct% off' : '${rupees(o.value)} off';
  final cap = o.kind == 'PERCENT' && o.maxDiscountPaise != null ? ' (up to ${rupees(o.maxDiscountPaise!)})' : '';
  final min = o.minOrderPaise > 0 ? ' on orders over ${rupees(o.minOrderPaise)}' : '';
  return '$off$cap$min';
}

class _OfferTile extends StatelessWidget {
  const _OfferTile({required this.offer});
  final HomeOffer offer;
  @override
  Widget build(BuildContext context) {
    final o = offer;
    return Container(
      width: 260,
      padding: const EdgeInsets.all(12),
      decoration: _card,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(offerText(o), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
        Text(
          [o.description, o.vendorName == null ? 'On anything in the shop' : 'At ${o.vendorName}'].whereType<String>().join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: Brand.muted, fontSize: 12),
        ),
        const Spacer(),
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(border: Border.all(color: Brand.teal), borderRadius: BorderRadius.circular(6)),
            child: Text(o.code, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.teal, letterSpacing: 1)),
          ),
          const Spacer(),
          TextButton(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: o.code));
              if (!context.mounted) return;
              showMessage(context, 'Code ${o.code} copied. Use it at checkout${o.endsAt == null ? '' : ' by ${shortDate(o.endsAt!)}'}.');
              context.push(o.vendorId == null ? '/shop' : '/shop?vendor=${o.vendorId}&name=${Uri.encodeQueryComponent(o.vendorName ?? '')}');
            },
            child: const Text('Use code'),
          ),
        ]),
      ]),
    );
  }
}

class _UpcomingTile extends StatelessWidget {
  const _UpcomingTile({required this.item});
  final UpcomingItem item;
  @override
  Widget build(BuildContext context) {
    final icon = switch (item.kind) { 'BOOKING' => Icons.event_available_outlined, 'CHALLENGE' => Icons.local_fire_department_outlined, _ => Icons.emoji_events_outlined };
    return ListTile(
      leading: CircleAvatar(backgroundColor: const Color(0xFFDCEBE8), child: Icon(icon, color: Brand.teal)),
      title: Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text([if (item.at != null) '${item.label} ${dateTime(item.at!)}' else item.label, if (item.subtitle != null) item.subtitle!].join(' · ')),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push(item.route),
    );
  }
}
