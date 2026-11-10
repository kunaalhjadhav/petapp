import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../chat/chat_screens.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/paged_controller.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../challenges/challenge_screens.dart' show BadgeShelf;
import '../privacy/privacy_screens.dart';
import '../safety/report_screen.dart';

Widget _stat(String n, String label) => Column(children: [Text(n, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)), Text(label, style: const TextStyle(color: Brand.muted))]);

/// Your own profile: posts, saved, pets.
class MeScreen extends ConsumerWidget {
  const MeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    return me.when(
      loading: () => const Scaffold(body: LoadingView()),
      error: (e, _) => Scaffold(body: ErrorView(error: e, onRetry: () => ref.invalidate(meProvider))),
      data: (m) => DefaultTabController(
        length: 3,
        child: Scaffold(
          appBar: AppBar(title: Text(m.name ?? 'Me'), actions: [
            if (ref.watch(servicesEnabledProvider)) IconButton(icon: const Icon(Icons.event_note_outlined), tooltip: 'My bookings', onPressed: () => context.push('/my-bookings')),
            if (m.isJudge) IconButton(icon: const Icon(Icons.gavel_outlined), tooltip: 'Judging', onPressed: () => context.push('/judging')),
            if (ref.watch(chatEnabledProvider)) _MessagesButton(unread: ref.watch(chatUnreadProvider).valueOrNull?.customer ?? 0),
            IconButton(icon: const Icon(Icons.account_balance_wallet_outlined), tooltip: 'Payments and refunds', onPressed: () => context.push('/money')),
            IconButton(icon: const Icon(Icons.settings_outlined), tooltip: 'Settings', onPressed: () => context.push('/settings')),
          ]),
          body: NestedScrollView(
            headerSliverBuilder: (ctx, _) => [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(children: [
                    Avatar(url: m.avatarUrl, name: m.name, size: 72),
                    const SizedBox(width: 16),
                    Expanded(child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [_stat('${m.pets}', 'Pets'), _stat(compact(m.followers), 'Followers'), _stat(compact(m.following), 'Following')])),
                  ]),
                ),
              ),
              if (m.memberPlan != null || ref.watch(membershipsEnabledProvider))
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(children: [
                      if (m.memberPlan != null) MemberBadge(plan: m.memberPlan!),
                      const Spacer(),
                      if (ref.watch(membershipsEnabledProvider))
                        TextButton.icon(onPressed: () => context.push('/membership'), icon: const Icon(Icons.workspace_premium_outlined, size: 18), label: Text(m.memberPlan == null ? 'Become a member' : 'Membership')),
                    ]),
                  ),
                ),
              const SliverToBoxAdapter(child: BadgeShelf()),
              const SliverToBoxAdapter(child: TabBar(tabs: [Tab(text: 'Posts'), Tab(text: 'Saved'), Tab(text: 'Pets')])),
            ],
            body: TabBarView(children: [
              _Grid(provider: userPostsProvider(m.id), empty: 'Share your first post from the Create tab.'),
              _Grid(provider: savedPostsProvider, empty: 'Posts you save appear here. Only you can see them.'),
              const _MyPets(),
            ]),
          ),
        ),
      ),
    );
  }
}

class _MessagesButton extends StatelessWidget {
  const _MessagesButton({required this.unread});
  final int unread;
  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: 'Messages',
        onPressed: () => context.push('/messages'),
        icon: Badge(isLabelVisible: unread > 0, label: Text(unread > 99 ? '99+' : '$unread'), child: const Icon(Icons.chat_bubble_outline)),
      );
}

class _Grid extends ConsumerWidget {
  const _Grid({required this.provider, required this.empty});
  final AutoDisposeStateNotifierProvider<PagedController<Post>, PagedState<Post>> provider;
  final String empty;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(provider);
    if (!s.loadedOnce) return const LoadingView();
    if (s.items.isEmpty) return s.error != null ? ErrorView(error: s.error!, onRetry: ref.read(provider.notifier).refresh) : EmptyView(title: 'Nothing here yet', message: empty);
    if (!s.done) ref.read(provider.notifier).loadMoreSoon();
    return CustomScrollView(slivers: [PostGrid(posts: s.items)]);
  }
}

class _MyPets extends ConsumerWidget {
  const _MyPets();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pets = ref.watch(myPetsProvider);
    return pets.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(myPetsProvider)),
      data: (list) => ListView(children: [
        for (final p in list)
          ListTile(
            leading: Avatar(url: p.avatarUrl, name: p.name),
            title: Text(p.name),
            subtitle: Text('@${p.handle} · ${p.breedName ?? p.speciesName}'),
            onTap: () => context.push('/pet/${p.id}'),
          ),
        ListTile(leading: const Icon(Icons.add_circle_outline, color: Brand.teal), title: const Text('Add a pet'), onTap: () => context.push('/pets/new')),
      ]),
    );
  }
}

final _profileProvider = FutureProvider.autoDispose.family<PublicProfile, String>((ref, id) => ref.watch(apiProvider).profile(id));

/// Someone else's profile.
class UserScreen extends ConsumerWidget {
  const UserScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final meId = ref.watch(authProvider).me?.id;
    if (meId == id) return const MeScreen();
    final profile = ref.watch(_profileProvider(id));
    final api = ref.read(apiProvider);
    return Scaffold(
      appBar: AppBar(actions: [
        PopupMenuButton<String>(
          onSelected: (v) async {
            try {
              if (v == 'block') {
                await api.block(id);
                if (context.mounted) {
                  showMessage(context, 'Blocked.');
                  context.pop();
                }
              } else {
                await reportContent(context, 'USER', id, 'account');
              }
            } catch (e) {
              if (context.mounted) showError(context, e);
            }
          },
          itemBuilder: (_) => const [PopupMenuItem(value: 'report', child: Text('Report')), PopupMenuItem(value: 'block', child: Text('Block'))],
        ),
      ]),
      body: profile.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_profileProvider(id))),
        data: (u) {
          final posts = ref.watch(userPostsProvider(id));
          if (posts.loadedOnce && !posts.done) ref.read(userPostsProvider(id).notifier).loadMoreSoon();
          return CustomScrollView(slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Avatar(url: u.avatarUrl, name: u.name, size: 72),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(u.name ?? 'PetApp member', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
                        if (u.memberPlan != null) MemberBadge(plan: u.memberPlan!),
                        if (u.city != null) Text(u.city!, style: const TextStyle(color: Brand.muted)),
                        Text('${compact(u.followers)} followers · ${compact(u.following)} following'),
                      ]),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: u.isFollowing
                        ? OutlinedButton(onPressed: () => api.unfollow(id).then((_) => ref.invalidate(_profileProvider(id))).catchError((Object e) => showError(context, e)), child: const Text('Following'))
                        : FilledButton(onPressed: () => api.follow(id).then((_) => ref.invalidate(_profileProvider(id))).catchError((Object e) => showError(context, e)), child: const Text('Follow')),
                  ),
                  if (u.pets.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Wrap(spacing: 8, children: [for (final p in u.pets) ActionChip(avatar: const Icon(Icons.pets, size: 16), label: Text(p.name), onPressed: () => context.push('/pet/${p.id}'))]),
                  ],
                ]),
              ),
            ),
            PostGrid(posts: posts.items),
            if (posts.loadedOnce && posts.items.isEmpty) const SliverToBoxAdapter(child: EmptyView(title: 'No posts yet')),
          ]);
        },
      ),
    );
  }
}

final _prefsProvider = FutureProvider.autoDispose<NotificationPrefs>((ref) => ref.watch(apiProvider).notificationPrefs());
final _blocksProvider = FutureProvider.autoDispose<List<PersonRef>>((ref) => ref.watch(apiProvider).blocks());

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  static const _labels = {
    'push': ('Push notifications', 'Alerts on this phone'),
    'likes': ('Likes', 'When someone likes your post'),
    'comments': ('Comments and replies', null),
    'mentions': ('Mentions of your pets', null),
    'follows': ('New followers', 'Of you and your pets'),
    'posts': ('Your posts', 'When a reel finishes processing'),
    'chat': ('Messages', 'From partners, sellers and PetApp support'),
    'reminders': ('Reminders', 'Before a booked visit, and before contest entries or voting close'),
    'votes': ('Votes on your entries', 'At most once an hour'),
    'promotions': ('Offers and announcements', 'From PetApp. Off unless you turn it on'),
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(_prefsProvider);
    final blocks = ref.watch(_blocksProvider);
    final api = ref.read(apiProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(children: [
        const ListTile(title: Text('Notifications', style: TextStyle(fontWeight: FontWeight.w700))),
        prefs.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_prefsProvider)),
          data: (p) => Column(children: [
            for (final k in NotificationPrefs.keys)
              SwitchListTile(
                title: Text(_labels[k]!.$1),
                subtitle: _labels[k]!.$2 == null ? null : Text(_labels[k]!.$2!),
                value: p.values[k] ?? !NotificationPrefs.optIn.contains(k),
                onChanged: (v) async {
                  try {
                    await api.setNotificationPrefs({k: v});
                    ref.invalidate(_prefsProvider);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  }
                },
              ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text('Account and safety notices are always sent.', style: TextStyle(color: Brand.muted, fontSize: 12)),
            ),
          ]),
        ),
        if (ref.watch(membershipsEnabledProvider)) ...[
          const Divider(),
          ListTile(leading: const Icon(Icons.workspace_premium_outlined), title: const Text('Membership'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/membership')),
        ],
        const Divider(),
        const ListTile(title: Text('Recommendations', style: TextStyle(fontWeight: FontWeight.w700))),
        const _RecoSettings(),
        const Divider(),
        const ListTile(title: Text('Blocked people', style: TextStyle(fontWeight: FontWeight.w700))),
        blocks.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e),
          data: (list) => list.isEmpty
              ? const ListTile(title: Text('No one', style: TextStyle(color: Brand.muted)))
              : Column(children: [
                  for (final b in list)
                    ListTile(
                      leading: Avatar(url: b.avatarUrl, name: b.name),
                      title: Text(b.name ?? 'Someone'),
                      trailing: TextButton(
                        onPressed: () async {
                          try {
                            await api.unblock(b.id);
                            ref.invalidate(_blocksProvider);
                          } catch (e) {
                            if (context.mounted) showError(context, e);
                          }
                        },
                        child: const Text('Unblock'),
                      ),
                    ),
                ]),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.help_outline),
          title: const Text('Help & support'),
          subtitle: const Text('Answers, and writing to the PetApp team'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push('/help'),
        ),
        ListTile(
          leading: const Icon(Icons.privacy_tip_outlined),
          title: const Text('Your data and privacy'),
          subtitle: const Text('Download your data, offers and news, policies'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push('/settings/privacy'),
        ),
        ListTile(leading: const Icon(Icons.logout), title: const Text('Sign out'), onTap: () => ref.read(authProvider.notifier).logout()),
        ListTile(
          leading: const Icon(Icons.delete_forever_outlined, color: Brand.heart),
          title: const Text('Delete account', style: TextStyle(color: Brand.heart)),
          onTap: () => confirmDeleteAccount(context, ref),
        ),
        const SizedBox(height: 24),
      ]),
    );
  }
}

/// Personalised recommendations on or off, what they're based on, and clearing what was viewed.
class _RecoSettings extends ConsumerWidget {
  const _RecoSettings();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiProvider);
    Future<void> run(Future<RecoSettings> Function() f, String done) async {
      try {
        await f();
        ref.invalidate(recoSettingsProvider);
        ref.invalidate(homeProvider);
        if (context.mounted) showMessage(context, done);
      } catch (e) {
        if (context.mounted) showError(context, e);
      }
    }

    return ref.watch(recoSettingsProvider).when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(recoSettingsProvider)),
          data: (r) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SwitchListTile(
              title: const Text('Personalised for you'),
              subtitle: Text(!r.availableOnPlatform
                  ? 'PetApp isn’t personalising recommendations right now. Everyone sees popular and nearby picks.'
                  : r.personalised
                      ? 'Based on: ${r.basedOn.join('; ')}.'
                      : 'Off: you see popular and nearby picks, and what you look at isn’t kept.'),
              isThreeLine: true,
              value: r.personalised,
              onChanged: (v) => run(() => api.setPersonalised(v), v ? 'Personalisation is on' : 'Personalisation is off. What you viewed has been deleted.'),
            ),
            ListTile(
              leading: const Icon(Icons.history_toggle_off),
              title: const Text('Clear viewing history'),
              subtitle: Text(r.viewsKept == 0 && r.hiddenItems == 0
                  ? 'Nothing kept. Views are deleted after ${r.historyDays} days.'
                  : '${r.viewsKept} viewed item${r.viewsKept == 1 ? '' : 's'} and ${r.hiddenItems} marked “Not interested”. Views are deleted after ${r.historyDays} days.'),
              enabled: r.viewsKept > 0 || r.hiddenItems > 0,
              onTap: () => run(api.clearRecoHistory, 'Cleared'),
            ),
          ]),
        );
  }
}
