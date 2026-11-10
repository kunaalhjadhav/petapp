import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config_share.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/payment_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../../common/share_button.dart';
import '../contests/contest_screens.dart' show rupees;

final _challengesProvider = FutureProvider.autoDispose.family<List<ChallengeCard>, String>((ref, when) => ref.watch(apiProvider).challenges(when: when));
final _challengeProvider = FutureProvider.autoDispose.family<ChallengeDetail, String>((ref, id) => ref.watch(apiProvider).challenge(id));
final _challengeBoardProvider = FutureProvider.autoDispose.family<ChallengeBoard, String>((ref, id) => ref.watch(apiProvider).challengeBoard(id));
final myBadgesProvider = FutureProvider.autoDispose<List<EarnedBadge>>((ref) => ref.watch(apiProvider).myBadges());

String _who(ChallengeCard c) => switch (c.kind) { 'PAID' => '${rupees(c.feePaise)} to join', 'CONTEST_LINKED' => 'For contest entrants', _ => 'Free' };

class ChallengesScreen extends StatelessWidget {
  const ChallengesScreen({super.key});
  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 3,
        child: Scaffold(
          appBar: AppBar(title: const Text('Challenges'), bottom: const TabBar(tabs: [Tab(text: 'Active'), Tab(text: 'Upcoming'), Tab(text: 'Past')])),
          body: const TabBarView(children: [_List(when: 'active'), _List(when: 'upcoming'), _List(when: 'past')]),
        ),
      );
}

class _List extends ConsumerWidget {
  const _List({required this.when});
  final String when;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(_challengesProvider(when)).when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_challengesProvider(when))),
        data: (items) => items.isEmpty
            ? const EmptyView(title: 'No challenges here yet')
            : RefreshIndicator(
                onRefresh: () async => ref.invalidate(_challengesProvider(when)),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (ctx, i) {
                    final c = items[i];
                    final m = c.mine;
                    return Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Brand.line)),
                      child: ListTile(
                        contentPadding: const EdgeInsets.all(14),
                        leading: const CircleAvatar(backgroundColor: Color(0xFFF3EACB), child: Icon(Icons.local_fire_department, color: Brand.heart)),
                        title: Text(c.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text(m == null
                            ? '${c.requiredCheckIns} days · ${_who(c)} · ${c.participants} joined${c.badgeName != null ? ' · badge' : ''}'
                            : '${m.checkIns}/${c.requiredCheckIns} done · ${m.points} pts${m.streak > 0 ? ' · 🔥 ${m.streak}' : ''}'),
                        onTap: () => Navigator.of(ctx).push(MaterialPageRoute<void>(builder: (_) => ChallengeScreen(id: c.id))),
                      ),
                    );
                  },
                ),
              ),
      );
}

class ChallengeScreen extends ConsumerStatefulWidget {
  const ChallengeScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<ChallengeScreen> createState() => _ChallengeScreenState();
}

class _ChallengeScreenState extends ConsumerState<ChallengeScreen> {
  bool _busy = false;

  Future<void> _go(Future<void> Function() f) async {
    setState(() => _busy = true);
    try {
      await f();
    } on PaymentCancelled catch (e) {
      if (mounted) showMessage(context, e.message);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      ref.invalidate(_challengeProvider(widget.id));
      ref.invalidate(_challengeBoardProvider(widget.id));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _join(ChallengeDetail d) => _go(() async {
        final api = ref.read(apiProvider);
        final r = await api.joinChallenge(d.card.id);
        if (r.payment != null) await PaymentService(api).pay(r.payment!, description: d.card.title);
        if (mounted) showMessage(context, 'You’re in! Check in once a day.');
      });

  Future<void> _checkIn(ChallengeDetail d) async {
    final api = ref.read(apiProvider);
    String? text;
    String? postId;
    if (d.card.proof == 'TEXT') {
      final ctrl = TextEditingController();
      text = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('How did today go?'),
          content: TextField(controller: ctrl, autofocus: true, maxLength: 500),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Check in'))],
        ),
      );
      if (text == null || text.isEmpty) return;
    } else if (d.card.proof == 'POST') {
      final me = ref.read(authProvider).me;
      if (me == null) return;
      final posts = (await api.userPosts(me.id)).items;
      if (!mounted) return;
      if (posts.isEmpty) return showMessage(context, 'Share today’s post first, then check in with it.');
      final picked = await showModalBottomSheet<Post>(
        context: context,
        showDragHandle: true,
        builder: (ctx) => SafeArea(
          child: ListView(shrinkWrap: true, children: [
            const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Choose today’s post', style: TextStyle(fontWeight: FontWeight.w700))),
            for (final p in posts.take(20)) ListTile(title: Text(p.caption ?? 'Post', maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text(ago(p.publishedAt)), onTap: () => Navigator.pop(ctx, p)),
          ]),
        ),
      );
      if (picked == null) return;
      postId = picked.id;
    }
    await _go(() async {
      final r = await api.checkIn(d.card.id, postId: postId, text: text);
      if (!mounted) return;
      final parts = ['+${r.earned} points', if (r.bonus > 0) 'streak bonus!', if (r.streak > 1) '🔥 ${r.streak} days'];
      showMessage(context, r.badgeName != null ? 'Challenge complete! You earned the “${r.badgeName}” badge.' : r.completed && r.checkIns == r.requiredCheckIns ? 'Challenge complete!' : parts.join(' · '));
    });
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(_challengeProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Challenge'), actions: [
        if (detail.valueOrNull case final d?) ShareButton(kind: ShareKind.challenge, linkKey: d.card.id, text: 'Join ${d.card.title} on PetApp'),
      ]),
      body: detail.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_challengeProvider(widget.id))),
        data: (d) {
          final c = d.card;
          final m = c.mine;
          final board = ref.watch(_challengeBoardProvider(widget.id)).valueOrNull;
          return ListView(padding: const EdgeInsets.all(16), children: [
            Text(c.title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(d.description),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              Chip(label: Text('${c.requiredCheckIns} check-ins')),
              Chip(label: Text('${c.pointsPerCheckIn} pts each')),
              if (c.streakBonusEvery > 0) Chip(label: Text('+${c.streakBonusPoints} every ${c.streakBonusEvery} days in a row')),
              if (c.badgeName != null) Chip(avatar: const Icon(Icons.military_tech, size: 18), label: Text(c.badgeName!)),
              Chip(label: Text(_who(c))),
              if (c.membersOnly) const Chip(avatar: Icon(Icons.workspace_premium, size: 18, color: Brand.teal), label: Text('Premium · members only')),
            ]),
            const SizedBox(height: 16),
            if (m == null || m.status == 'WITHDRAWN') ...[
              if (c.status == 'PUBLISHED' && (c.endsAt == null || DateTime.now().isBefore(c.endsAt!)))
                FilledButton(onPressed: _busy ? null : () => _join(d), child: Text(c.kind == 'PAID' ? 'Join · ${rupees(c.feePaise)}' : 'Join challenge')),
            ] else if (m.status == 'PENDING_PAYMENT' && d.payment != null)
              FilledButton(onPressed: _busy ? null : () => _go(() => PaymentService(ref.read(apiProvider)).pay(d.payment!, description: c.title)), child: Text('Pay ${rupees(d.payment!.amountPaise)} to start'))
            else ...[
              Text('${m.checkIns} of ${c.requiredCheckIns} done · ${m.points} points', style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              LinearProgressIndicator(value: c.requiredCheckIns == 0 ? 0 : (m.checkIns / c.requiredCheckIns).clamp(0, 1).toDouble(), minHeight: 8, borderRadius: BorderRadius.circular(4)),
              const SizedBox(height: 8),
              Text(m.streak > 0 ? '🔥 ${m.streak}-day streak (best ${d.longestStreak})' : 'Check in today to start a streak.'),
              const SizedBox(height: 12),
              if (m.status == 'COMPLETED') const Text('Completed! 🎉 Keep checking in for points.', style: TextStyle(color: Brand.teal, fontWeight: FontWeight.w600)),
              if (c.running)
                FilledButton.icon(
                  onPressed: _busy || m.checkedInToday ? null : () => _checkIn(d),
                  icon: Icon(m.checkedInToday ? Icons.check : Icons.local_fire_department),
                  label: Text(m.checkedInToday ? 'Checked in today' : 'Check in for today'),
                ),
            ],
            if (board != null && board.rows.isNotEmpty) ...[
              const SizedBox(height: 24),
              Text('Rankings${board.myRank != null ? ' · you’re #${board.myRank}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              for (final r in board.rows.take(10))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(child: Text('${r.rank}')),
                  title: Text(r.userName + (r.petName != null ? ' & ${r.petName}' : '')),
                  subtitle: Text('${r.checkIns} check-ins${r.streak > 0 ? ' · 🔥 ${r.streak}' : ''}${r.completed ? ' · completed' : ''}'),
                  trailing: Text('${r.points} pts', style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
            ],
          ]);
        },
      ),
    );
  }
}

/// Badges row for the profile.
class BadgeShelf extends ConsumerWidget {
  const BadgeShelf({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final badges = ref.watch(myBadgesProvider).valueOrNull ?? const <EarnedBadge>[];
    if (badges.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 44,
      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
        for (final b in badges)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Tooltip(message: b.description, child: Chip(avatar: const Icon(Icons.military_tech, size: 18, color: Brand.heart), label: Text(b.name))),
          ),
      ]),
    );
  }
}
