import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import 'reviews_logic.dart';

// Reviews of your business (Phase 9b): your rating, every review, and one public reply to each.
// The same file in the partner and seller apps: both API classes have myReviews, reviewsOverview and replyToReview.

final reviewsOverviewProvider = FutureProvider.autoDispose<ReviewsOverview>((ref) => ref.watch(apiProvider).reviewsOverview());

/// Business-tab entry: your rating and how many reviews wait for a reply.
class ReviewsTile extends ConsumerWidget {
  const ReviewsTile({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final o = ref.watch(reviewsOverviewProvider).valueOrNull;
    final line = o == null ? 'What customers say' : ratingLine(o.summary.avg, o.summary.count);
    return ListTile(
      leading: const Icon(Icons.star_outline_rounded),
      title: const Text('Reviews'),
      subtitle: Text(o != null && o.unanswered > 0 ? '$line · ${o.unanswered} to reply to' : line),
      onTap: () => openReviews(context),
    );
  }
}

Future<void> openReviews(BuildContext context) => Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => const ReviewsScreen()));

class ReviewsScreen extends ConsumerStatefulWidget {
  const ReviewsScreen({super.key});
  @override
  ConsumerState<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends ConsumerState<ReviewsScreen> {
  static const _filters = [('unanswered', 'Needs a reply'), ('all', 'All'), ('photos', 'With photos'), ('1', '1 ★'), ('2', '2 ★'), ('3', '3 ★'), ('4', '4 ★'), ('5', '5 ★')];
  final _items = <BusinessReview>[];
  String _filter = 'unanswered';
  int _page = 1;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
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
      final f = reviewFilter(_filter);
      final (items, more) = await ref.read(apiProvider).myReviews(page: _page, unanswered: _filter == 'unanswered', stars: f['stars'] as int?, photos: f['photos'] == 'true');
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

  Future<void> _reply(BusinessReview r) async {
    final text = TextEditingController();
    final sent = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        String? problem;
        return StatefulBuilder(
          builder: (ctx, set) => AlertDialog(
            title: const Text('Reply publicly'),
            content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${starsText(r.rating)}  ${r.by}', style: TextStyle(color: Colors.amber.shade800)),
              if (r.comment != null) Padding(padding: const EdgeInsets.only(top: 4, bottom: 8), child: Text(r.comment!, maxLines: 4, overflow: TextOverflow.ellipsis)),
              TextField(
                controller: text,
                autofocus: true,
                maxLength: 1000,
                minLines: 3,
                maxLines: 6,
                decoration: InputDecoration(hintText: 'Thank them, or explain what you’ll do differently', errorText: problem),
              ),
              const Text('Everyone can read your reply. You can reply once, and it can’t be edited.', style: TextStyle(color: Brand.muted, fontSize: 12)),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
              FilledButton(
                onPressed: () {
                  final p = replyProblem(text.text);
                  if (p != null) {
                    set(() => problem = p);
                  } else {
                    Navigator.pop(ctx, true);
                  }
                },
                child: const Text('Post reply'),
              ),
            ],
          ),
        );
      },
    );
    if (sent != true) return;
    try {
      await ref.read(apiProvider).replyToReview(r.id, text.text.trim());
      if (!mounted) return;
      showMessage(context, 'Reply posted.');
      ref.invalidate(reviewsOverviewProvider);
      await _load(reset: true);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = ref.watch(reviewsOverviewProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Reviews')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(reviewsOverviewProvider);
          await _load(reset: true);
        },
        child: NotificationListener<ScrollNotification>(
          onNotification: (n) {
            if (n.metrics.pixels > n.metrics.maxScrollExtent - 400) _load();
            return false;
          },
          child: ListView(padding: const EdgeInsets.symmetric(horizontal: 16), children: [
            if (o != null) Padding(padding: const EdgeInsets.only(top: 12), child: _Summary(overview: o)),
            SizedBox(
              height: 52,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final (key, label) in _filters)
                  Padding(
                    padding: const EdgeInsets.only(right: 6, top: 8, bottom: 8),
                    child: ChoiceChip(
                      label: Text(label),
                      selected: _filter == key,
                      onSelected: (_) {
                        _filter = key;
                        _load(reset: true);
                      },
                    ),
                  ),
              ]),
            ),
            for (final r in _items) ...[_ReviewCard(review: r, onReply: () => _reply(r)), const Divider(height: 1)],
            if (_error != null) ErrorView(error: _error!, onRetry: () => _load(reset: _items.isEmpty)),
            if (_loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
            if (!_loading && _error == null && _items.isEmpty)
              EmptyView(
                title: _filter == 'unanswered' ? 'You’re all caught up' : 'No reviews here yet',
                message: _filter == 'unanswered' ? 'Every review has a reply.' : 'Customers can review once their order arrives or their visit is completed.',
              ),
          ]),
        ),
      ),
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.overview});
  final ReviewsOverview overview;
  @override
  Widget build(BuildContext context) {
    final s = overview.summary;
    final shares = starShares([for (final x in s.stars) x.count]);
    return Row(children: [
      Column(children: [
        Text(s.count == 0 ? '–' : s.avg.toStringAsFixed(1), style: Theme.of(context).textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w700)),
        Text('${s.count} review${s.count == 1 ? '' : 's'}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
      ]),
      const SizedBox(width: 20),
      Expanded(
        child: Column(children: [
          for (final (i, x) in s.stars.indexed)
            Semantics(
              label: '${x.stars} stars: ${x.count}',
              excludeSemantics: true,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [
                  SizedBox(width: 14, child: Text('${x.stars}', style: const TextStyle(fontSize: 12, color: Brand.muted))),
                  const SizedBox(width: 6),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(value: i < shares.length ? shares[i] / 100 : 0, minHeight: 6, backgroundColor: Brand.line, color: Colors.amber.shade700),
                    ),
                  ),
                  const SizedBox(width: 6),
                  SizedBox(width: 28, child: Text('${x.count}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 12, color: Brand.muted))),
                ]),
              ),
            ),
        ]),
      ),
    ]);
  }
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review, required this.onReply});
  final BusinessReview review;
  final VoidCallback onReply;
  @override
  Widget build(BuildContext context) {
    final r = review;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Semantics(label: '${r.rating} out of 5 stars', excludeSemantics: true, child: Text(starsText(r.rating), style: TextStyle(color: Colors.amber.shade800, fontSize: 16))),
          const SizedBox(width: 8),
          Expanded(child: Text([r.by, if (r.at != null) reviewDate(r.at!, DateTime.now())].join(' · '), style: const TextStyle(color: Brand.muted, fontSize: 13))),
        ]),
        if (r.about.isNotEmpty) Text(r.about, style: const TextStyle(color: Brand.muted, fontSize: 12)),
        if (r.hidden) const Text('Hidden by PetApp after a review. It isn’t shown or counted.', style: TextStyle(color: Brand.heart, fontSize: 12)),
        if (r.comment != null && r.comment!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(r.comment!)),
        if (r.photos.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(spacing: 6, children: [
              for (final (i, p) in r.photos.indexed)
                if (p.imageFor(160) case final url?)
                  Semantics(
                    label: 'Photo ${i + 1} from ${r.by}',
                    child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(url, width: 72, height: 72, fit: BoxFit.cover)),
                  ),
            ]),
          ),
        if (r.reply != null)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Brand.line.withAlpha(90), borderRadius: BorderRadius.circular(10)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Your reply', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.muted)),
              const SizedBox(height: 2),
              Text(r.reply!),
            ]),
          )
        else if (r.canReply)
          Align(alignment: Alignment.centerLeft, child: TextButton.icon(onPressed: onReply, icon: const Icon(Icons.reply, size: 18), label: const Text('Reply'))),
      ]),
    );
  }
}
