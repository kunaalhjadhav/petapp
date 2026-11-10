import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../api/models.dart';

/// Whether playback reached the last moments of the video (it loops, so this is checked as it plays).
bool reachedEnd(Duration position, Duration duration) =>
    duration > const Duration(milliseconds: 500) && position >= duration - const Duration(milliseconds: 400);

/// HLS video with its poster frame. Plays when [playing] is true; loops.
class VideoView extends StatefulWidget {
  const VideoView({super.key, required this.media, required this.playing, this.fit = BoxFit.cover, this.onFirstSecond, this.onReachedEnd});
  final Media media;
  final bool playing;
  final BoxFit fit;

  /// Called once after a second of playback (counts a view).
  final VoidCallback? onFirstSecond;

  /// Called once when the video first plays to its end (reels completion rate, Phase 9d).
  final VoidCallback? onReachedEnd;

  @override
  State<VideoView> createState() => _VideoViewState();
}

class _VideoViewState extends State<VideoView> {
  VideoPlayerController? _c;
  bool _failed = false;
  bool _counted = false;
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    if (widget.playing) _init();
  }

  @override
  void didUpdateWidget(VideoView old) {
    super.didUpdateWidget(old);
    if (widget.playing && _c == null) _init();
    if (_c != null && _c!.value.isInitialized) widget.playing ? _c!.play() : _c!.pause();
  }

  Future<void> _init() async {
    final url = widget.media.hls;
    if (url == null) return;
    final c = VideoPlayerController.networkUrl(Uri.parse(url), formatHint: VideoFormat.hls);
    _c = c;
    try {
      await c.initialize();
      await c.setLooping(true);
      c.addListener(_onTick);
      if (mounted && widget.playing) await c.play();
      if (mounted) setState(() {});
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  void _onTick() {
    final c = _c;
    if (!_counted && c != null && c.value.position >= const Duration(seconds: 1)) {
      _counted = true;
      widget.onFirstSecond?.call();
    }
    if (!_finished && c != null && reachedEnd(c.value.position, c.value.duration)) {
      _finished = true;
      widget.onReachedEnd?.call();
    }
  }

  @override
  void dispose() {
    _c?.removeListener(_onTick);
    _c?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    final ready = c != null && c.value.isInitialized;
    return Stack(fit: StackFit.expand, children: [
      if (widget.media.poster != null) CachedNetworkImage(imageUrl: widget.media.poster!, fit: widget.fit),
      if (ready)
        FittedBox(fit: widget.fit, clipBehavior: Clip.hardEdge, child: SizedBox(width: c.value.size.width, height: c.value.size.height, child: VideoPlayer(c))),
      if (_failed) const Center(child: Text('Video unavailable', style: TextStyle(color: Colors.white))),
      if (!widget.playing && !_failed) const Center(child: Icon(Icons.play_circle_fill_rounded, color: Colors.white70, size: 56)),
    ]);
  }
}
