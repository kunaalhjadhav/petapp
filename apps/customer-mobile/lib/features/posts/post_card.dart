import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../config_share.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import 'video_view.dart';
import '../safety/report_screen.dart';

/// One post in a feed. Like/save update instantly and roll back if the request fails.
class PostCard extends ConsumerStatefulWidget {
  const PostCard({super.key, required this.post, this.onRemoved});
  final Post post;
  final VoidCallback? onRemoved;
  @override
  ConsumerState<PostCard> createState() => _PostCardState();
}

class _PostCardState extends ConsumerState<PostCard> {
  late Post _p = widget.post;
  int _page = 0;
  bool _playing = false;

  @override
  void didUpdateWidget(PostCard old) {
    super.didUpdateWidget(old);
    if (old.post.id != widget.post.id) _p = widget.post;
  }

  Future<void> _toggleLike() async {
    final before = _p;
    final on = !_p.liked;
    setState(() => _p = _p.copyWith(liked: on, counts: _p.counts.copyWith(likes: _p.counts.likes + (on ? 1 : -1))));
    try {
      final count = await ref.read(apiProvider).like(_p.id, on);
      if (mounted) setState(() => _p = _p.copyWith(counts: _p.counts.copyWith(likes: count)));
    } catch (e) {
      if (!mounted) return;
      setState(() => _p = before);
      showError(context, e);
    }
  }

  Future<void> _toggleSave() async {
    final before = _p;
    final on = !_p.saved;
    setState(() => _p = _p.copyWith(saved: on));
    try {
      await ref.read(apiProvider).save(_p.id, on);
      if (mounted) showMessage(context, on ? 'Saved' : 'Removed from saved');
    } catch (e) {
      if (!mounted) return;
      setState(() => _p = before);
      showError(context, e);
    }
  }

  Future<void> _share() async {
    final api = ref.read(apiProvider);
    await Share.share(shareLink(ShareKind.reel, _p.id));
    try {
      await api.share(_p.id, 'system');
    } catch (_) {}
  }

  Future<void> _menu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_p.isAuthor) ListTile(leading: const Icon(Icons.delete_outline), title: const Text('Delete post'), onTap: () => Navigator.pop(ctx, 'delete')),
          if (!_p.isAuthor) ...[
            ListTile(leading: const Icon(Icons.flag_outlined), title: const Text('Report post'), onTap: () => Navigator.pop(ctx, 'report')),
            ListTile(leading: const Icon(Icons.block), title: Text('Block ${_p.author.name ?? 'this person'}'), onTap: () => Navigator.pop(ctx, 'block')),
          ],
        ]),
      ),
    );
    if (!mounted || choice == null) return;
    final api = ref.read(apiProvider);
    try {
      if (choice == 'delete') {
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Delete this post?'),
            content: const Text('It will be removed for everyone. This can’t be undone.'),
            actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete'))],
          ),
        );
        if (ok != true) return;
        await api.deletePost(_p.id);
        widget.onRemoved?.call();
      } else if (choice == 'report') {
        await reportContent(context, 'POST', _p.id, 'post');
      } else if (choice == 'block') {
        await api.block(_p.author.id);
        widget.onRemoved?.call();
        if (mounted) showMessage(context, 'Blocked. You won’t see each other’s posts.');
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ListTile(
        contentPadding: const EdgeInsets.fromLTRB(16, 4, 4, 4),
        leading: GestureDetector(onTap: () => context.push('/user/${_p.author.id}'), child: Avatar(url: _p.author.avatarUrl, name: _p.author.name)),
        title: GestureDetector(onTap: () => context.push('/user/${_p.author.id}'), child: Text(_p.author.name ?? 'Someone', style: const TextStyle(fontWeight: FontWeight.w600))),
        subtitle: Text([ago(_p.publishedAt), if (_p.locationName != null) _p.locationName!, if (_p.visibility == 'FOLLOWERS') 'Followers'].join(' · ')),
        trailing: IconButton(icon: const Icon(Icons.more_horiz), onPressed: _menu, tooltip: 'More'),
      ),
      if (_p.status != 'PUBLISHED')
        Container(
          width: double.infinity,
          color: const Color(0xFFF3EACB),
          padding: const EdgeInsets.all(12),
          child: Text(_p.status == 'PROCESSING' ? '${_p.type == 'PHOTO' ? 'Your photos are' : 'Your video is'} still being processed. We’ll notify you when it’s live.' : 'This post couldn’t be published.'),
        ),
      if (_p.media.isNotEmpty) _mediaView(),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Row(children: [
          IconButton(
            onPressed: _toggleLike,
            tooltip: _p.liked ? 'Unlike' : 'Like',
            icon: Icon(_p.liked ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: _p.liked ? Brand.heart : null),
          ),
          Text(compact(_p.counts.likes)),
          IconButton(onPressed: () => context.push('/post/${_p.id}'), tooltip: 'Comments', icon: const Icon(Icons.chat_bubble_outline_rounded)),
          Text(compact(_p.counts.comments)),
          IconButton(onPressed: _share, tooltip: 'Share', icon: const Icon(Icons.ios_share_rounded)),
          const Spacer(),
          IconButton(onPressed: _toggleSave, tooltip: _p.saved ? 'Unsave' : 'Save', icon: Icon(_p.saved ? Icons.bookmark_rounded : Icons.bookmark_border_rounded)),
        ]),
      ),
      if (_p.pets.isNotEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Wrap(spacing: 6, children: [
            for (final pet in _p.pets)
              ActionChip(avatar: const Icon(Icons.pets, size: 16), label: Text(pet.name), onPressed: () => context.push('/pet/${pet.id}')),
          ]),
        ),
      if ((_p.caption ?? '').isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 0), child: _Caption(text: _p.caption!, style: t.bodyMedium)),
      const SizedBox(height: 16),
    ]);
  }

  Widget _mediaView() {
    final first = _p.media.first;
    final ratio = first.aspectRatio.clamp(0.8, 1.91); // keep feeds tidy, like most social apps
    return AspectRatio(
      aspectRatio: ratio,
      child: Stack(children: [
        PageView.builder(
          itemCount: _p.media.length,
          onPageChanged: (i) => setState(() {
            _page = i;
            _playing = false;
          }),
          itemBuilder: (ctx, i) {
            final m = _p.media[i];
            if (!m.isReady) return Container(color: Brand.line, child: const Center(child: CircularProgressIndicator()));
            if (m.isVideo) {
              return GestureDetector(
                onTap: () => setState(() => _playing = !_playing),
                child: VideoView(media: m, playing: _playing && i == _page, onFirstSecond: () => ref.read(apiProvider).view(_p.id).catchError((_) {})),
              );
            }
            final url = m.imageFor(MediaQuery.sizeOf(ctx).width * MediaQuery.devicePixelRatioOf(ctx));
            return url == null ? Container(color: Brand.line) : CachedNetworkImage(imageUrl: url, fit: BoxFit.cover, width: double.infinity);
          },
        ),
        if (_p.media.length > 1)
          Positioned(
            bottom: 8,
            left: 0,
            right: 0,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 0; i < _p.media.length; i++)
                Container(
                  width: 6,
                  height: 6,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  decoration: BoxDecoration(shape: BoxShape.circle, color: i == _page ? Colors.white : Colors.white54),
                ),
            ]),
          ),
      ]),
    );
  }
}

/// Caption with tappable #hashtags (same rules as the API, including Indian scripts).
class _Caption extends StatelessWidget {
  const _Caption({required this.text, this.style});
  final String text;
  final TextStyle? style;
  static final _tag = RegExp(r'(^|[\s(\[{"' "'" r'“‘])#([\p{L}\p{M}\p{N}_]{1,50})', unicode: true);

  @override
  Widget build(BuildContext context) {
    final spans = <InlineSpan>[];
    var last = 0;
    for (final m in _tag.allMatches(text)) {
      final start = m.start + m.group(1)!.length;
      spans.add(TextSpan(text: text.substring(last, start)));
      final tag = m.group(2)!;
      spans.add(WidgetSpan(
        alignment: PlaceholderAlignment.baseline,
        baseline: TextBaseline.alphabetic,
        child: GestureDetector(onTap: () => context.push('/hashtag/${Uri.encodeComponent(tag.toLowerCase())}'), child: Text('#$tag', style: style?.copyWith(color: Brand.teal))),
      ));
      last = m.end;
    }
    spans.add(TextSpan(text: text.substring(last)));
    return Text.rich(TextSpan(style: style, children: spans));
  }
}
