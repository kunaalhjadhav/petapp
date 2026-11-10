import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';

final _judgeContestsProvider = FutureProvider.autoDispose<List<JudgeContest>>((ref) => ref.watch(apiProvider).judgeContests());
final _judgeEntriesProvider = FutureProvider.autoDispose.family<List<JudgeEntry>, String>((ref, id) => ref.watch(apiProvider).judgeEntries(id));

/// For accounts with the Judge role: contests assigned to them that are being scored.
class JudgeHomeScreen extends ConsumerWidget {
  const JudgeHomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Judging')),
        body: ref.watch(_judgeContestsProvider).when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_judgeContestsProvider)),
              data: (list) => list.isEmpty
                  ? const EmptyView(title: 'Nothing to judge right now', message: 'Contests you’re assigned to appear here once voting starts.')
                  : ListView(children: [
                      for (final c in list)
                        ListTile(
                          title: Text(c.title),
                          subtitle: Text('${c.entries} entries · ${c.frozen ? 'scores locked' : 'open for scoring'}'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => JudgeContestScreen(contest: c))),
                        ),
                    ]),
            ),
      );
}

class JudgeContestScreen extends ConsumerWidget {
  const JudgeContestScreen({super.key, required this.contest});
  final JudgeContest contest;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: Text(contest.title)),
        body: ref.watch(_judgeEntriesProvider(contest.id)).when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_judgeEntriesProvider(contest.id))),
              data: (entries) => entries.isEmpty
                  ? const EmptyView(title: 'No entries to score yet')
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: entries.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (ctx, i) => _ScoreCard(contest: contest, entry: entries[i], onSaved: () => ref.invalidate(_judgeEntriesProvider(contest.id))),
                    ),
            ),
      );
}

class _ScoreCard extends ConsumerStatefulWidget {
  const _ScoreCard({required this.contest, required this.entry, required this.onSaved});
  final JudgeContest contest;
  final JudgeEntry entry;
  final VoidCallback onSaved;
  @override
  ConsumerState<_ScoreCard> createState() => _ScoreCardState();
}

class _ScoreCardState extends ConsumerState<_ScoreCard> {
  late final Map<String, double> _scores = {for (final c in widget.contest.criteria) c.id: widget.entry.myScores[c.id] ?? 5};
  bool _saving = false;

  /// Same weighting the leaderboard uses.
  double get _weighted {
    var total = 0.0;
    var w = 0;
    for (final c in widget.contest.criteria) {
      total += (_scores[c.id] ?? 0) * c.weight;
      w += c.weight;
    }
    return w == 0 ? 0 : total / w;
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.entry;
    final scored = e.myScores.length == widget.contest.criteria.length;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: scored ? Brand.teal : Brand.line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(e.petName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
          if (scored) const Icon(Icons.check_circle, color: Brand.teal, size: 20),
        ]),
        for (final s in e.submissions)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: s.postId != null
                ? TextButton.icon(onPressed: () => context.push('/post/${s.postId}'), icon: const Icon(Icons.photo_outlined), label: Text('${s.task}: view post'))
                : Text('${s.task}: “${s.text ?? ''}”'),
          ),
        const Divider(),
        for (final c in widget.contest.criteria) ...[
          Text('${c.name} (${c.weight}%) · ${_scores[c.id]!.toStringAsFixed(1)}'),
          Slider(
            value: _scores[c.id]!,
            max: 10,
            divisions: 20,
            label: _scores[c.id]!.toStringAsFixed(1),
            onChanged: widget.contest.frozen ? null : (v) => setState(() => _scores[c.id] = v),
          ),
        ],
        Row(children: [
          Expanded(child: Text('Weighted score ${_weighted.toStringAsFixed(2)} / 10', style: const TextStyle(color: Brand.muted))),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(96, 40)),
            onPressed: widget.contest.frozen || _saving
                ? null
                : () async {
                    setState(() => _saving = true);
                    try {
                      await ref.read(apiProvider).saveScores(e.id, _scores);
                      if (context.mounted) showMessage(context, 'Scores saved for ${e.petName}');
                      widget.onSaved();
                    } catch (err) {
                      if (context.mounted) showError(context, err);
                    } finally {
                      if (mounted) setState(() => _saving = false);
                    }
                  },
            child: Text(_saving ? 'Saving…' : 'Save'),
          ),
        ]),
      ]),
    );
  }
}
