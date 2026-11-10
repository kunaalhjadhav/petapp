import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../posts/video_view.dart';
import '../safety/report_screen.dart';

class ReelsScreen extends ConsumerStatefulWidget {
  const ReelsScreen({super.key});
  @override
  ConsumerState<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends ConsumerState<ReelsScreen> {
  int _current = 0;
  bool _paused = false;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(feedProvider(FeedKind.reels));
    final ctrl = ref.read(feedProvider(FeedKind.reels).notifier);
    final reels = state.items.where((p) => p.media.isNotEmpty && p.media.first.isReady && p.media.first.isVideo).toList();

    Widget body;
    if (!state.loadedOnce) {
      body = const LoadingView();
    } else if (reels.isEmpty) {
      body = state.error != null
          ? ErrorView(error: state.error!, onRetry: ctrl.refresh)
          : const EmptyView(title: 'No reels yet', message: 'Share a short video of your pet to get things started.');
    } else {
      body = PageView.builder(
        scrollDirection: Axis.vertical,
        itemCount: reels.length,
        onPageChanged: (i) {
          setState(() {
            _current = i;
            _paused = false;
          });
          if (i >= reels.length - 3) ctrl.loadMoreSoon();
        },
        itemBuilder: (ctx, i) => _Reel(
          post: reels[i],
          playing: i == _current && !_paused,
          onTap: () => setState(() => _paused = !_paused),
        ),
      );
    }
    return Scaffold(backgroundColor: Colors.black, body: DefaultTextStyle(style: const TextStyle(color: Colors.white), child: body));
  }
}

class _Reel extends ConsumerStatefulWidget {
  const _Reel({required this.post, required this.playing, required this.onTap});
  final Post post;
  final bool playing;
  final VoidCallback onTap;
  @override
  ConsumerState<_Reel> createState() => _ReelState();
}

class _ReelState extends ConsumerState<_Reel> {
  late Post _p = widget.post;

  Future<void> _like() async {
    final before = _p;
    final on = !_p.liked;
    setState(() => _p = _p.copyWith(liked: on, counts: _p.counts.copyWith(likes: _p.counts.likes + (on ? 1 : -1))));
    try {
      await ref.read(apiProvider).like(_p.id, on);
    } catch (e) {
      if (!mounted) return;
      setState(() => _p = before);
      showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = _p.media.first;
    return Stack(fit: StackFit.expand, children: [
      GestureDetector(
        onTap: widget.onTap,
        onDoubleTap: _p.liked ? null : _like,
        child: VideoView(media: m, playing: widget.playing, fit: BoxFit.cover, onFirstSecond: () => ref.read(apiProvider).view(_p.id).catchError((_) {}),
          onReachedEnd: () => ref.read(apiProvider).viewedToEnd(_p.id).catchError((_) {}),
        ),
      ),
      // Legibility gradient behind the overlay text.
      const IgnorePointer(
        child: DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.center, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black54]))),
      ),
      Positioned(
        right: 8,
        bottom: 96,
        child: Column(children: [
          _Action(icon: _p.liked ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: _p.liked ? Brand.heart : Colors.white, label: compact(_p.counts.likes), onTap: _like, tooltip: 'Like'),
          _Action(icon: Icons.chat_bubble_outline_rounded, label: compact(_p.counts.comments), onTap: () => context.push('/post/${_p.id}'), tooltip: 'Comments'),
          _Action(icon: Icons.more_horiz, label: '', tooltip: 'More', onTap: () async {
            await reportContent(context, 'POST', _p.id, 'reel');
          }),
        ]),
      ),
      Positioned(
        left: 16,
        right: 80,
        bottom: 32,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          GestureDetector(
            onTap: () => context.push('/user/${_p.author.id}'),
            child: Row(children: [
              Avatar(url: _p.author.avatarUrl, name: _p.author.name, size: 32),
              const SizedBox(width: 8),
              Text(_p.author.name ?? 'Someone', style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white)),
            ]),
          ),
          if ((_p.caption ?? '').isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_p.caption!, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white))),
          if (_p.pets.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('🐾 ${_p.pets.map((x) => x.name).join(', ')}', style: const TextStyle(color: Colors.white70)),
            ),
        ]),
      ),
    ]);
  }
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label, required this.onTap, required this.tooltip, this.color = Colors.white});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final String tooltip;
  final Color color;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Column(children: [
          IconButton(icon: Icon(icon, color: color, size: 32), onPressed: onTap, tooltip: tooltip),
          if (label.isNotEmpty) Text(label, style: const TextStyle(color: Colors.white, fontSize: 12)),
        ]),
      );
}
