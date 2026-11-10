import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/upload_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../safety/report_screen.dart';
import 'reviews_logic.dart';

// Reviews and ratings (spec §38): the summary, review cards, all reviews with filters, and writing one.
// Every review comes from a delivered order or a completed booking, so each shows "Verified purchase/booking".

enum ReviewSubject { product, partner }

/// The average, and a bar for each number of stars.
class RatingSummaryView extends StatelessWidget {
  const RatingSummaryView({super.key, required this.summary});
  final RatingSummary summary;
  @override
  Widget build(BuildContext context) {
    final shares = starShares([for (final s in summary.stars) s.count]);
    return Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
      Column(children: [
        Text(summary.avg.toStringAsFixed(1), style: Theme.of(context).textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w700)),
        Text(starsText(summary.avg.round()), style: TextStyle(color: Colors.amber.shade800)),
        Text('${summary.count} review${summary.count == 1 ? '' : 's'}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
      ]),
      const SizedBox(width: 20),
      Expanded(
        child: Column(children: [
          for (final (i, s) in summary.stars.indexed)
            Semantics(
              label: '${s.stars} stars: ${s.count}',
              excludeSemantics: true,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [
                  SizedBox(width: 14, child: Text('${s.stars}', style: const TextStyle(fontSize: 12, color: Brand.muted))),
                  const SizedBox(width: 6),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(value: i < shares.length ? shares[i] / 100 : 0, minHeight: 6, backgroundColor: Brand.line, color: Colors.amber.shade700),
                    ),
                  ),
                  const SizedBox(width: 6),
                  SizedBox(width: 28, child: Text('${s.count}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 12, color: Brand.muted))),
                ]),
              ),
            ),
        ]),
      ),
    ]);
  }
}

/// One review: stars, who and when, the words, photos, and the business's reply.
class ReviewCard extends StatelessWidget {
  const ReviewCard({super.key, required this.review, required this.subject, this.showReport = true});
  final ReviewView review;
  final ReviewSubject subject;
  final bool showReport;
  @override
  Widget build(BuildContext context) {
    final r = review;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Semantics(label: '${r.rating} out of 5 stars', excludeSemantics: true, child: Text(starsText(r.rating), style: TextStyle(color: Colors.amber.shade800, fontSize: 16))),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              [r.by, if (r.at != null) reviewDate(r.at!, DateTime.now())].join(' · '),
              style: const TextStyle(color: Brand.muted, fontSize: 13),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (showReport)
            IconButton(
              tooltip: 'Report this review',
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.flag_outlined, size: 18, color: Brand.muted),
              onPressed: () => reportContent(context, subject == ReviewSubject.product ? 'PRODUCT_REVIEW' : 'SERVICE_REVIEW', r.id, 'review'),
            ),
        ]),
        Wrap(spacing: 8, children: [
          if (r.verified)
            Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.verified_outlined, size: 14, color: Brand.teal),
              const SizedBox(width: 3),
              Text(subject == ReviewSubject.product ? 'Verified purchase' : 'Verified booking', style: const TextStyle(fontSize: 12, color: Brand.teal, fontWeight: FontWeight.w600)),
            ]),
          if (r.variantTitle != null) Text(r.variantTitle!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
          if (r.hidden) const Text('Hidden by PetApp', style: TextStyle(fontSize: 12, color: Brand.heart)),
        ]),
        if (r.comment != null && r.comment!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(r.comment!)),
        if (r.photos.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: SizedBox(
              height: 72,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: r.photos.length,
                separatorBuilder: (_, __) => const SizedBox(width: 6),
                itemBuilder: (ctx, i) {
                  final url = r.photos[i].imageFor(160);
                  return url == null
                      ? const SizedBox.shrink()
                      : Semantics(
                          button: true,
                          label: 'Photo ${i + 1} from ${r.by}',
                          child: InkWell(
                            onTap: () => _viewPhotos(ctx, r.photos, i),
                            child: ClipRRect(borderRadius: BorderRadius.circular(8), child: CachedNetworkImage(imageUrl: url, width: 72, height: 72, fit: BoxFit.cover)),
                          ),
                        );
                },
              ),
            ),
          ),
        if (r.reply != null)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Brand.line.withAlpha(90), borderRadius: BorderRadius.circular(10)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Reply from the business', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.muted)),
              const SizedBox(height: 2),
              Text(r.reply!),
            ]),
          ),
      ]),
    );
  }
}

void _viewPhotos(BuildContext context, List<Media> photos, int start) {
  Navigator.of(context).push(MaterialPageRoute<void>(
    fullscreenDialog: true,
    builder: (_) => Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white),
      body: PageView(
        controller: PageController(initialPage: start),
        children: [
          for (final m in photos)
            if (m.imageFor(1080) case final url?) InteractiveViewer(child: Center(child: CachedNetworkImage(imageUrl: url, fit: BoxFit.contain))),
        ],
      ),
    ),
  ));
}

/// The summary and the latest reviews, with a link to all of them. Used on product and partner pages.
class ReviewsSection extends StatelessWidget {
  const ReviewsSection({super.key, required this.subject, required this.id, required this.title, this.summary, required this.recent, required this.count});
  final ReviewSubject subject;
  final String id;
  final String title;
  final RatingSummary? summary;
  final List<ReviewView> recent;
  final int count;
  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Reviews${count > 0 ? ' ($count)' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
      const SizedBox(height: 8),
      if (count == 0)
        Text(subject == ReviewSubject.product ? 'No reviews yet. People who buy it can review it after it’s delivered.' : 'No reviews yet. Customers can review a visit once it’s completed.',
            style: const TextStyle(color: Brand.muted))
      else ...[
        if (summary != null) RatingSummaryView(summary: summary!),
        for (final r in recent) ReviewCard(review: r, subject: subject),
        if (count > recent.length)
          TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ReviewsScreen(subject: subject, id: id, title: title))),
            child: Text('See all $count reviews'),
          ),
      ],
    ]);
  }
}

/// Every review, newest first, with star and photo filters.
class ReviewsScreen extends ConsumerStatefulWidget {
  const ReviewsScreen({super.key, required this.subject, required this.id, required this.title});
  final ReviewSubject subject;
  final String id;
  final String title;
  @override
  ConsumerState<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends ConsumerState<ReviewsScreen> {
  static const _filters = [('all', 'All'), ('photos', 'With photos'), ('5', '5 ★'), ('4', '4 ★'), ('3', '3 ★'), ('2', '2 ★'), ('1', '1 ★')];
  final _items = <ReviewView>[];
  String _filter = 'all';
  String _sort = 'recent';
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
      final api = ref.read(apiProvider);
      final f = reviewFilter(_filter);
      final stars = f['stars'] as int?;
      final photos = f['photos'] == 'true';
      final (items, more) = widget.subject == ReviewSubject.product
          ? await api.productReviews(widget.id, page: _page, stars: stars, photos: photos, sort: _sort)
          : await api.partnerReviews(widget.id, page: _page, stars: stars, photos: photos, sort: _sort);
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Reviews of ${widget.title}'), actions: [
        PopupMenuButton<String>(
          tooltip: 'Sort',
          icon: const Icon(Icons.sort),
          initialValue: _sort,
          onSelected: (v) {
            _sort = v;
            _load(reset: true);
          },
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'recent', child: Text('Newest first')),
            PopupMenuItem(value: 'highest', child: Text('Highest rated')),
            PopupMenuItem(value: 'lowest', child: Text('Lowest rated')),
          ],
        ),
      ]),
      body: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 400) _load();
          return false;
        },
        child: ListView(padding: const EdgeInsets.symmetric(horizontal: 16), children: [
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
          for (final r in _items) ...[ReviewCard(review: r, subject: widget.subject), const Divider(height: 1)],
          if (_error != null) ErrorView(error: _error!, onRetry: () => _load(reset: _items.isEmpty)),
          if (_loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
          if (!_loading && _error == null && _items.isEmpty) const EmptyView(title: 'No reviews match', message: 'Try another filter.'),
        ]),
      ),
    );
  }
}

/// Stars, words and up to four photos. [submit] posts it and receives the uploaded photo ids.
/// Returns true when the review was posted.
Future<bool> writeReview(
  BuildContext context, {
  required String title,
  required String subtitle,
  required Future<void> Function(int rating, String comment, List<String> photoIds) submit,
}) async {
  final ok = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(fullscreenDialog: true, builder: (_) => WriteReviewScreen(title: title, subtitle: subtitle, submit: submit)),
  );
  if (ok == true && context.mounted) showMessage(context, 'Thanks for your review!');
  return ok == true;
}

class WriteReviewScreen extends ConsumerStatefulWidget {
  const WriteReviewScreen({super.key, required this.title, required this.subtitle, required this.submit});
  final String title;
  final String subtitle;
  final Future<void> Function(int rating, String comment, List<String> photoIds) submit;
  @override
  ConsumerState<WriteReviewScreen> createState() => _WriteReviewScreenState();
}

class _WriteReviewScreenState extends ConsumerState<WriteReviewScreen> {
  final _text = TextEditingController();
  final _photos = <XFile>[];
  int _rating = 0;
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2400, imageQuality: 85);
    if (f != null && mounted) setState(() => _photos.add(f));
  }

  Future<void> _post() async {
    if (_rating == 0) {
      showMessage(context, 'Tap a star to rate it.');
      return;
    }
    setState(() => _busy = true);
    try {
      // Review photos are public, like the review.
      final uploads = UploadService(ref.read(apiProvider));
      final ids = <String>[for (final f in _photos) await uploads.uploadPhoto(f, private: false)];
      await widget.submit(_rating, _text.text.trim(), ids);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        Text(widget.subtitle, style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 16),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 1; i <= 5; i++)
            IconButton(
              tooltip: '$i star${i == 1 ? '' : 's'}',
              iconSize: 40,
              onPressed: _busy ? null : () => setState(() => _rating = i),
              icon: Icon(i <= _rating ? Icons.star_rounded : Icons.star_outline_rounded, color: Colors.amber.shade700),
            ),
        ]),
        Center(child: Text(ratingWord(_rating), style: Theme.of(context).textTheme.titleMedium)),
        const SizedBox(height: 16),
        TextField(
          controller: _text,
          maxLength: 1000,
          minLines: 3,
          maxLines: 6,
          enabled: !_busy,
          decoration: InputDecoration(hintText: reviewHint(_rating == 0 ? 5 : _rating), border: const OutlineInputBorder()),
        ),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final (i, f) in _photos.indexed)
            InputChip(avatar: const Icon(Icons.image_outlined, size: 18), label: Text('Photo ${i + 1}'), onDeleted: _busy ? null : () => setState(() => _photos.remove(f))),
          if (_photos.length < reviewPhotoMax)
            ActionChip(avatar: const Icon(Icons.add_a_photo_outlined, size: 18), label: const Text('Add a photo'), onPressed: _busy ? null : _addPhoto),
        ]),
        const SizedBox(height: 8),
        const Text('Your review shows your first name and initial. Photos are public.', style: TextStyle(color: Brand.muted, fontSize: 13)),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: _busy ? null : _post,
          child: _busy ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Post review'),
        ),
      ]),
    );
  }
}
