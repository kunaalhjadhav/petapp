import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config_share.dart';
import '../../api/api_client.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/payment_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../../common/share_button.dart';
import '../privacy/privacy_screens.dart';
import '../safety/report_screen.dart';

String rupees(int paise) {
  final r = paise ~/ 100;
  final p = paise % 100;
  final s = r.toString();
  // Indian grouping: 1,00,000
  final head = s.length > 3 ? s.substring(0, s.length - 3) : '';
  final tail = s.length > 3 ? s.substring(s.length - 3) : s;
  final grouped = head.isEmpty ? tail : '${head.replaceAllMapped(RegExp(r'\B(?=(\d{2})+(?!\d))'), (m) => ',')},$tail';
  return '₹$grouped${p == 0 ? '' : '.${p.toString().padLeft(2, '0')}'}';
}

const statusLabels = {
  'SCHEDULED': 'Upcoming',
  'LIVE': 'Open for entries',
  'VOTING': 'Voting',
  'EVALUATION': 'Judging',
  'WINNER_DECLARATION': 'Results soon',
  'COMPLETED': 'Finished',
  'CANCELLED': 'Cancelled',
};

final _contestsProvider = FutureProvider.autoDispose.family<List<ContestCard>, String>((ref, when) => ref.watch(apiProvider).contests(when: when));
final _contestProvider = FutureProvider.autoDispose.family<ContestDetail, String>((ref, id) => ref.watch(apiProvider).contest(id));
final _boardProvider = FutureProvider.autoDispose.family<Leaderboard, String>((ref, id) => ref.watch(apiProvider).leaderboard(id));

class ContestsScreen extends StatelessWidget {
  const ContestsScreen({super.key});
  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 3,
        child: Scaffold(
          appBar: AppBar(title: const Text('Contests'), bottom: const TabBar(tabs: [Tab(text: 'Live'), Tab(text: 'Upcoming'), Tab(text: 'Past')])),
          body: const TabBarView(children: [_ContestList(when: 'live'), _ContestList(when: 'upcoming'), _ContestList(when: 'past')]),
        ),
      );
}

class _ContestList extends ConsumerWidget {
  const _ContestList({required this.when});
  final String when;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(_contestsProvider(when));
    return list.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_contestsProvider(when))),
      data: (items) => items.isEmpty
          ? EmptyView(title: when == 'past' ? 'No finished contests yet' : 'No contests right now', message: when == 'past' ? null : 'Check back soon.')
          : RefreshIndicator(
              onRefresh: () async => ref.invalidate(_contestsProvider(when)),
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (ctx, i) => _ContestTile(c: items[i]),
              ),
            ),
    );
  }
}

class _ContestTile extends StatelessWidget {
  const _ContestTile({required this.c});
  final ContestCard c;
  @override
  Widget build(BuildContext context) {
    final top = c.prizes.where((p) => p.rank == 1).firstOrNull;
    return InkWell(
      onTap: () => context.push('/contest/${c.id}'),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.line)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            height: 96,
            width: double.infinity,
            color: Brand.teal,
            child: c.bannerUrl == null ? null : CachedNetworkImage(imageUrl: c.bannerUrl!, fit: BoxFit.cover),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (c.categoryName != null) Text(c.categoryName!, style: const TextStyle(color: Brand.muted, fontSize: 12)),
              Text(c.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
              const SizedBox(height: 6),
              Wrap(spacing: 12, children: [
                Text(c.isFree ? 'Free entry' : '${rupees(c.feePaise)} entry'),
                if (c.membersOnly) const Text('Members only', style: TextStyle(color: Brand.teal, fontWeight: FontWeight.w600)),
                Text('${c.entries}${c.maxParticipants != null ? ' / ${c.maxParticipants}' : ''} entries'),
                Text(statusLabels[c.status] ?? c.status, style: const TextStyle(color: Brand.teal, fontWeight: FontWeight.w600)),
              ]),
              if (top != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('🏆 ${top.title}${top.amountPaise != null ? ' · ${rupees(top.amountPaise!)}' : ''}')),
            ]),
          ),
        ]),
      ),
    );
  }
}

class ContestScreen extends ConsumerStatefulWidget {
  const ContestScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<ContestScreen> createState() => _ContestScreenState();
}

class _ContestScreenState extends ConsumerState<ContestScreen> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() f, {String? done}) async {
    setState(() => _busy = true);
    try {
      await f();
      if (mounted && done != null) showMessage(context, done);
    } on PaymentCancelled catch (e) {
      if (mounted) showMessage(context, e.message);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      ref.invalidate(_contestProvider(widget.id));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _enter(ContestDetail c) async {
    final pets = await ref.read(apiProvider).myPets();
    if (!mounted) return;
    if (pets.isEmpty) {
      showMessage(context, 'Add your pet first.');
      context.push('/pets/new');
      return;
    }
    final already = c.myEntries.map((e) => e.petName).toSet();
    final pet = await showModalBottomSheet<Pet>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Which pet is entering?', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
          for (final p in pets)
            ListTile(
              leading: Avatar(url: p.avatarUrl, name: p.name),
              title: Text(p.name),
              subtitle: Text(already.contains(p.name) ? 'Already entered' : (p.breedName ?? p.speciesName)),
              enabled: !already.contains(p.name),
              onTap: () => Navigator.pop(ctx, p),
            ),
        ]),
      ),
    );
    if (pet == null) return;
    await _run(() async {
      // The Contest Terms must be accepted first (once, per version); the sheet asks and the entry goes on.
      final r = await withTerms(context, ref, () => ref.read(apiProvider).registerForContest(c.card.id, pet.id));
      if (r == null) throw PaymentCancelled('Not entered. Accept the Contest Terms to enter ${pet.name}.');
      if (r.payment != null) await PaymentService(ref.read(apiProvider)).pay(r.payment!, description: '${c.card.title}: ${pet.name}');
    }, done: c.card.isFree ? '${pet.name} is in!' : 'Payment confirmed. ${pet.name} is in!');
  }

  Future<void> _submit(MyEntry e, ContestTask t) async {
    final api = ref.read(apiProvider);
    if (t.type == 'TEXT') {
      final ctrl = TextEditingController();
      final text = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(t.title),
          content: TextField(controller: ctrl, autofocus: true, maxLength: 2000, minLines: 2, maxLines: 6),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Submit'))],
        ),
      );
      if (text == null || text.isEmpty) return;
      await _run(() => api.submitTask(e.id, t.id, text: text), done: 'Submitted');
      return;
    }
    final me = ref.read(authProvider).me;
    if (me == null) return;
    final page = await api.userPosts(me.id);
    if (!mounted) return;
    if (page.items.isEmpty) {
      showMessage(context, 'Share a post first, then choose it here.');
      return;
    }
    final post = await showModalBottomSheet<Post>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Choose a post for “${t.title}”', style: const TextStyle(fontWeight: FontWeight.w700))),
          for (final p in page.items)
            ListTile(
              leading: SizedBox(
                width: 48,
                height: 48,
                child: p.media.isEmpty
                    ? null
                    : CachedNetworkImage(imageUrl: (p.media.first.isVideo ? p.media.first.poster : p.media.first.imageFor(160)) ?? '', fit: BoxFit.cover),
              ),
              title: Text(p.caption ?? 'Post', maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Text(ago(p.publishedAt)),
              onTap: () => Navigator.pop(ctx, p),
            ),
        ]),
      ),
    );
    if (post == null) return;
    await _run(() => api.submitTask(e.id, t.id, postId: post.id), done: 'Submitted');
  }

  @override
  Widget build(BuildContext context) {
    final contest = ref.watch(_contestProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Contest'), actions: [
        if (contest.valueOrNull case final c?) ShareButton(kind: ShareKind.contest, linkKey: c.card.slug, text: '${c.card.title} on PetApp'),
      ]),
      body: contest.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_contestProvider(widget.id))),
        data: (c) {
          final k = c.card;
          return ListView(padding: const EdgeInsets.all(16), children: [
            if (k.bannerUrl != null) ClipRRect(borderRadius: BorderRadius.circular(16), child: CachedNetworkImage(imageUrl: k.bannerUrl!, height: 160, fit: BoxFit.cover)),
            const SizedBox(height: 12),
            if (k.categoryName != null) Text(k.categoryName!, style: const TextStyle(color: Brand.muted)),
            Text(k.title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(statusLabels[k.status] ?? k.status, style: const TextStyle(color: Brand.teal, fontWeight: FontWeight.w600)),
            if (c.cancelReason != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Cancelled: ${c.cancelReason}. Entry fees are refunded.', style: const TextStyle(color: Brand.heart))),
            const SizedBox(height: 12),
            Text(c.description),
            const SizedBox(height: 16),
            _facts(k, c),
            const SizedBox(height: 16),
            ..._entrySection(c),
            if (k.prizes.isNotEmpty) ...[
              const SizedBox(height: 16),
              const Text('Prizes', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              for (final p in k.prizes)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(backgroundColor: const Color(0xFFF3EACB), child: Text(p.rank != null ? '#${p.rank}' : '★')),
                  title: Text(p.title),
                  subtitle: Text([p.kind.toLowerCase(), if (p.amountPaise != null) rupees(p.amountPaise!)].join(' · ')),
                ),
            ],
            if (c.tasks.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text('What you’ll do', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              for (final t in c.tasks) ListTile(contentPadding: EdgeInsets.zero, leading: Icon(t.type == 'POST' ? Icons.photo_outlined : Icons.edit_note), title: Text(t.title), subtitle: t.description == null ? null : Text(t.description!)),
            ],
            if (['VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED'].contains(k.status))
              OutlinedButton.icon(onPressed: () => context.push('/contest/${k.id}/leaderboard'), icon: const Icon(Icons.leaderboard_outlined), label: Text(k.status == 'VOTING' ? 'See entries and vote' : 'Leaderboard')),
            if (c.rules != null) ExpansionTile(tilePadding: EdgeInsets.zero, title: const Text('Rules'), children: [Text(c.rules!)]),
            if (c.terms != null) ExpansionTile(tilePadding: EdgeInsets.zero, title: const Text('Terms'), children: [Text(c.terms!)]),
          ]);
        },
      ),
    );
  }

  Widget _facts(ContestCard k, ContestDetail c) {
    String d(DateTime? t) => t == null ? '—' : '${t.day}/${t.month} ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    final rows = <(String, String)>[
      ('Entry', k.isFree ? 'Free' : rupees(k.feePaise)),
      if (k.membersOnly) ('Who can enter', 'Members (see Membership in Settings)'),
      ('Entries', '${k.entries}${k.maxParticipants != null ? ' of ${k.maxParticipants}' : ''}'),
      ('Registration closes', d(k.registrationClosesAt)),
      ('Submissions close', d(k.submissionClosesAt)),
      ('Voting closes', d(k.votingClosesAt)),
      ('Winner decided by', c.publicWeight == 100 ? 'Public votes' : c.publicWeight == 0 ? 'Judges' : 'Votes ${c.publicWeight}% · Judges ${100 - c.publicWeight}%'),
    ];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.line)),
      child: Column(children: [
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(children: [Expanded(child: Text(r.$1, style: const TextStyle(color: Brand.muted))), Text(r.$2, style: const TextStyle(fontWeight: FontWeight.w600))]),
          ),
      ]),
    );
  }

  List<Widget> _entrySection(ContestDetail c) {
    final k = c.card;
    final out = <Widget>[];
    for (final e in c.myEntries) {
      out.add(Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFFEFF6F5), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${e.petName}’s entry', style: const TextStyle(fontWeight: FontWeight.w700)),
          Text(_entryStatus(e.status), style: const TextStyle(color: Brand.muted)),
          if (e.status == 'PENDING_PAYMENT' && e.payment != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: FilledButton(
                onPressed: _busy ? null : () => _run(() => PaymentService(ref.read(apiProvider)).pay(e.payment!, description: k.title), done: 'Payment confirmed'),
                child: Text('Pay ${rupees(e.payment!.amountPaise)} to complete'),
              ),
            ),
          if (k.status == 'LIVE' && (e.status == 'REGISTERED' || e.status == 'SUBMITTED'))
            for (final t in c.tasks)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(e.submittedTaskIds.contains(t.id) ? Icons.check_circle : Icons.radio_button_unchecked, color: e.submittedTaskIds.contains(t.id) ? Brand.teal : Brand.muted),
                title: Text(t.title),
                trailing: TextButton(onPressed: _busy ? null : () => _submit(e, t), child: Text(e.submittedTaskIds.contains(t.id) ? 'Change' : 'Submit')),
              ),
        ]),
      ));
    }
    if (k.registrationOpen) {
      out.add(FilledButton(
        onPressed: _busy ? null : () => _enter(c),
        child: Text(_busy ? 'Please wait…' : k.isFree ? 'Enter for free' : 'Enter · ${rupees(k.feePaise)}'),
      ));
    }
    return out;
  }

  String _entryStatus(String s) => switch (s) {
        'PENDING_PAYMENT' => 'Waiting for payment. Your place is held for 30 minutes.',
        'REGISTERED' => 'Entered. Complete the tasks before submissions close.',
        'SUBMITTED' => 'All tasks submitted. Good luck!',
        'QUALIFIED' => 'Qualified',
        'FINALIST' => 'Finalist!',
        'WINNER' => 'Winner! 🏆',
        'DISQUALIFIED' => 'Disqualified',
        _ => s,
      };
}

class LeaderboardScreen extends ConsumerWidget {
  const LeaderboardScreen({super.key, required this.contestId});
  final String contestId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final board = ref.watch(_boardProvider(contestId));
    final contest = ref.watch(_contestProvider(contestId)).valueOrNull;
    final voting = contest?.card.status == 'VOTING';
    final mine = contest?.myEntries.map((e) => e.id).toSet() ?? const <String>{};
    return Scaffold(
      appBar: AppBar(title: Text(voting ? 'Vote' : 'Leaderboard')),
      body: board.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_boardProvider(contestId))),
        data: (b) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(_boardProvider(contestId)),
          child: ListView(children: [
            if (voting && contest != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text('You can vote ${contest.votesPerUserPerDay == 1 ? 'once' : '${contest.votesPerUserPerDay} times'} a day. Scores combine public votes and judges.', style: const TextStyle(color: Brand.muted)),
              ),
            if (b.frozen) const Padding(padding: EdgeInsets.all(16), child: Text('Final results', style: TextStyle(fontWeight: FontWeight.w700))),
            if (b.rows.isEmpty) const EmptyView(title: 'No entries yet'),
            for (final r in b.rows)
              ListTile(
                leading: CircleAvatar(backgroundColor: r.rank <= 3 ? const Color(0xFFF3EACB) : const Color(0xFFEFF6F5), child: Text('${r.rank}')),
                title: Text(r.pet?.name ?? 'Entry'),
                subtitle: Text('${r.ownerName ?? ''} · ${r.votes} votes · score ${r.combined.toStringAsFixed(1)}${r.status == 'WINNER' ? ' · 🏆' : ''}'),
                onTap: r.pet == null ? null : () => context.push('/pet/${r.pet!.id}'),
                trailing: mine.contains(r.entryId)
                    ? null
                    : Row(mainAxisSize: MainAxisSize.min, children: [
                        if (voting)
                          OutlinedButton(
                            onPressed: () async {
                              try {
                                await ref.read(apiProvider).vote(r.entryId);
                                if (context.mounted) showMessage(context, 'Voted for ${r.pet?.name ?? 'this entry'}!');
                              } catch (e) {
                                if (context.mounted) {
                                  final err = ApiException.from(e);
                                  // Accounts made with Google or Apple have no verified number yet: add one, then vote.
                                  if (err.status == 403 && err.message.contains('mobile number')) {
                                    context.push('/settings/phone');
                                  } else {
                                    showError(context, e);
                                  }
                                }
                              }
                              ref.invalidate(_boardProvider(contestId));
                            },
                            child: const Text('Vote'),
                          ),
                        PopupMenuButton<String>(
                          tooltip: 'More',
                          onSelected: (_) => reportContent(context, 'CONTEST_ENTRY', r.entryId, 'contest entry'),
                          itemBuilder: (_) => const [PopupMenuItem(value: 'report', child: Text('Report this entry'))],
                        ),
                      ]),
              ),
          ]),
        ),
      ),
    );
  }
}
