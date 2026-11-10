import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../home/place.dart';
import '../home/search_logic.dart';

// Pet discovery (spec §62): trending pets, pets near you, popular reels, and pets in contests and challenges.

final _trendingProvider = FutureProvider.autoDispose<List<Pet>>((ref) => ref.watch(apiProvider).trendingPets());
final _contestEntriesProvider = FutureProvider.autoDispose<List<ContestEntryCard>>((ref) => ref.watch(apiProvider).contestEntries());
final _challengeEntriesProvider = FutureProvider.autoDispose<List<ChallengeEntryCard>>((ref) => ref.watch(apiProvider).challengeEntries());
final _nearbyProvider = FutureProvider.autoDispose.family<List<Pet>, ({double lat, double lng})>((ref, at) async => (await ref.watch(apiProvider).nearbyPets(lat: at.lat, lng: at.lng)).$1);

class DiscoverScreen extends ConsumerWidget {
  const DiscoverScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final social = ref.watch(socialEnabledProvider);
    final contests = ref.watch(contestsEnabledProvider);
    final tabs = <(String, Widget)>[
      ('Trending', const _TrendingTab()),
      ('Near you', const _NearbyTab()),
      if (social) ('Reels', const _ReelsTab()),
      if (contests) ('Contests', const _ContestTab()),
      if (contests) ('Challenges', const _ChallengeTab()),
    ];
    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Discover pets'),
          actions: [IconButton(tooltip: 'Search', icon: const Icon(Icons.search), onPressed: () => context.push('/search'))],
          bottom: TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [for (final t in tabs) Tab(text: t.$1)]),
        ),
        body: TabBarView(children: [for (final t in tabs) t.$2]),
      ),
    );
  }
}

/// A pet in a list, with an optional line under its name.
class _PetRow extends StatelessWidget {
  const _PetRow({required this.pet, this.line, this.trailing});
  final Pet pet;
  final String? line;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => ListTile(
        leading: Avatar(url: pet.avatarUrl, name: pet.name, size: 48),
        title: Row(children: [
          Flexible(child: Text(pet.name, overflow: TextOverflow.ellipsis)),
          if (pet.isVerified) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.verified_rounded, size: 16, color: Brand.teal)),
        ]),
        subtitle: Text(line ?? [pet.breedName ?? pet.speciesName, if (pet.city != null) pet.city!].where((s) => s.isNotEmpty).join(' · ')),
        trailing: trailing,
        onTap: () => context.push('/pet/${pet.handle}'),
      );
}

Widget _list<T>(AsyncValue<List<T>> v, VoidCallback retry, Widget Function(T) row, {required String empty, String? emptyMessage}) => v.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorView(error: e, onRetry: retry),
      data: (list) => list.isEmpty
          ? EmptyView(title: empty, message: emptyMessage)
          : RefreshIndicator(
              onRefresh: () async => retry(),
              child: ListView.separated(itemCount: list.length, separatorBuilder: (_, __) => const Divider(height: 1), itemBuilder: (_, i) => row(list[i])),
            ),
    );

class _TrendingTab extends ConsumerWidget {
  const _TrendingTab();
  @override
  Widget build(BuildContext context, WidgetRef ref) => _list<Pet>(
        ref.watch(_trendingProvider),
        () => ref.invalidate(_trendingProvider),
        (p) => _PetRow(pet: p, trailing: Text('${p.followerCount} followers', style: const TextStyle(color: Brand.muted, fontSize: 12))),
        empty: 'Nothing trending yet',
        emptyMessage: 'Pets gaining followers and likes this week show here.',
      );
}

class _NearbyTab extends ConsumerStatefulWidget {
  const _NearbyTab();
  @override
  ConsumerState<_NearbyTab> createState() => _NearbyTabState();
}

class _NearbyTabState extends ConsumerState<_NearbyTab> {
  bool _locating = true;

  @override
  void initState() {
    super.initState();
    locateOnce(ref).whenComplete(() {
      if (mounted) setState(() => _locating = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final place = ref.watch(searchPlaceProvider);
    final header = ListTile(
      leading: const Icon(Icons.place_outlined, color: Brand.teal),
      title: Text(place?.label ?? (_locating ? 'Finding you…' : 'Choose where')),
      subtitle: const Text('Only pets whose owners chose to appear here. Distances are rounded.'),
      trailing: TextButton(onPressed: () => pickPlace(context, ref), child: const Text('Change')),
    );
    if (place == null) {
      return Column(children: [
        header,
        Expanded(child: _locating ? const LoadingView() : EmptyView(title: 'Where should we look?', message: 'Allow location, or pick your city.', action: OutlinedButton(onPressed: () => pickPlace(context, ref), child: const Text('Choose a city')))),
      ]);
    }
    final at = (lat: place.at.lat, lng: place.at.lng);
    return Column(children: [
      header,
      const Divider(height: 1),
      Expanded(
        child: _list<Pet>(
          ref.watch(_nearbyProvider(at)),
          () => ref.invalidate(_nearbyProvider(at)),
          (p) => _PetRow(pet: p, trailing: Text(petDistanceLabel(p.distanceKm), style: const TextStyle(color: Brand.muted, fontSize: 12))),
          empty: 'No pets nearby yet',
          emptyMessage: 'Show yours here: open your pet’s profile and turn on “Show in Pets near you”.',
        ),
      ),
    ]);
  }
}

class _ReelsTab extends ConsumerStatefulWidget {
  const _ReelsTab();
  @override
  ConsumerState<_ReelsTab> createState() => _ReelsTabState();
}

class _ReelsTabState extends ConsumerState<_ReelsTab> {
  final _posts = <Post>[];
  String? _cursor;
  bool _done = false;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _more();
  }

  Future<void> _more() async {
    if (_loading || _done) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(apiProvider).popularReels(cursor: _cursor);
      if (!mounted) return;
      setState(() {
        _posts.addAll(page.items);
        _cursor = page.nextCursor;
        _done = page.nextCursor == null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_posts.isEmpty && _loading) return const LoadingView();
    if (_posts.isEmpty && _error != null) return ErrorView(error: _error!, onRetry: _more);
    if (_posts.isEmpty) return const EmptyView(title: 'No reels yet');
    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n.metrics.pixels > n.metrics.maxScrollExtent - 400) _more();
        return false;
      },
      child: CustomScrollView(slivers: [
        PostGrid(posts: _posts),
        if (_loading) const SliverToBoxAdapter(child: LoadingView()),
      ]),
    );
  }
}

class _ContestTab extends ConsumerWidget {
  const _ContestTab();
  @override
  Widget build(BuildContext context, WidgetRef ref) => _list<ContestEntryCard>(
        ref.watch(_contestEntriesProvider),
        () => ref.invalidate(_contestEntriesProvider),
        (e) => _PetRow(
          pet: e.pet,
          line: e.contestTitle,
          trailing: TextButton(onPressed: () => context.push(e.voting ? '/contest/${e.contestId}/leaderboard' : '/contest/${e.contestSlug}'), child: Text(e.voting ? 'Vote' : 'Contest')),
        ),
        empty: 'No contest entries right now',
        emptyMessage: 'Pets entered in open contests show here.',
      );
}

class _ChallengeTab extends ConsumerWidget {
  const _ChallengeTab();
  @override
  Widget build(BuildContext context, WidgetRef ref) => _list<ChallengeEntryCard>(
        ref.watch(_challengeEntriesProvider),
        () => ref.invalidate(_challengeEntriesProvider),
        (e) => _PetRow(
          pet: e.pet,
          line: '${e.challengeTitle} · ${challengeProgress(e.checkIns, e.requiredCheckIns, completed: e.completed)}',
          trailing: Text('${e.points} pts', style: const TextStyle(color: Brand.muted, fontSize: 12)),
        ),
        empty: 'No challenges on right now',
        emptyMessage: 'Pets taking part in this week’s challenges show here.',
      );
}
