import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../theme.dart';

String initials(String? name) {
  final parts = (name ?? '').trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
}

/// "just now", "5m", "3h", "2d", then a date.
String ago(DateTime? t, [DateTime? now]) {
  if (t == null) return '';
  final d = (now ?? DateTime.now()).difference(t);
  if (d.inSeconds < 45) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes}m';
  if (d.inHours < 24) return '${d.inHours}h';
  if (d.inDays <= 7) return '${d.inDays}d';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${t.day} ${months[t.month - 1]}';
}

String compact(int n) => n >= 1000000 ? '${(n / 1000000).toStringAsFixed(1)}M' : n >= 1000 ? '${(n / 1000).toStringAsFixed(n >= 10000 ? 0 : 1)}k' : '$n';

class Avatar extends StatelessWidget {
  const Avatar({super.key, this.url, this.name, this.size = 36});
  final String? url;
  final String? name;
  final double size;
  @override
  Widget build(BuildContext context) => CircleAvatar(
        radius: size / 2,
        backgroundColor: const Color(0xFFDCEBE8),
        foregroundImage: url != null ? CachedNetworkImageProvider(url!) : null,
        child: Text(initials(name), style: TextStyle(fontSize: size * 0.38, color: Brand.teal, fontWeight: FontWeight.w600)),
      );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) {
    final e = ApiException.from(error);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(e.isOffline ? Icons.wifi_off_rounded : Icons.error_outline_rounded, size: 40, color: Brand.muted),
          const SizedBox(height: 12),
          Text(e.message, textAlign: TextAlign.center),
          if (onRetry != null) ...[const SizedBox(height: 16), OutlinedButton(onPressed: onRetry, child: const Text('Try again'))],
        ]),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.title, this.message, this.action});
  final String title;
  final String? message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
            if (message != null) ...[const SizedBox(height: 6), Text(message!, textAlign: TextAlign.center, style: const TextStyle(color: Brand.muted))],
            if (action != null) ...[const SizedBox(height: 16), action!],
          ]),
        ),
      );
}

void showError(BuildContext context, Object e) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiException.from(e).message)));
}

void showMessage(BuildContext context, String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

/// Reasons match the API's ReportReason values (the report screen lists them).
const reportReasons = {
  'SPAM': 'Spam',
  'ABUSE': 'Abuse or harassment',
  'ANIMAL_WELFARE': 'An animal may be at risk',
  'NUDITY': 'Nudity',
  'VIOLENCE': 'Violence',
  'MISINFORMATION': 'False information',
  'IMPERSONATION': 'Pretending to be someone else',
  'OTHER': 'Something else',
};

/// Three-column grid of post thumbnails.
class PostGrid extends StatelessWidget {
  const PostGrid({super.key, required this.posts});
  final List<Post> posts;
  @override
  Widget build(BuildContext context) => SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, mainAxisSpacing: 2, crossAxisSpacing: 2),
        delegate: SliverChildBuilderDelegate((ctx, i) {
          final p = posts[i];
          final m = p.media.isEmpty ? null : p.media.first;
          final url = m == null ? null : (m.isVideo ? m.poster : m.imageFor(320));
          return InkWell(
            onTap: () => ctx.push('/post/${p.id}'),
            child: Stack(fit: StackFit.expand, children: [
              Container(color: Brand.line, child: url == null ? const Icon(Icons.hourglass_top_rounded, color: Brand.muted) : CachedNetworkImage(imageUrl: url, fit: BoxFit.cover)),
              if (m?.isVideo ?? false) const Positioned(right: 6, top: 6, child: Icon(Icons.play_arrow_rounded, color: Colors.white, size: 20)),
            ]),
          );
        }, childCount: posts.length),
      );
}

/// "Plus member" under a name (Phase 9d): shown when the person's plan includes the member badge.
class MemberBadge extends StatelessWidget {
  const MemberBadge({super.key, required this.plan});
  final String plan;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.workspace_premium, size: 16, color: Brand.teal),
          const SizedBox(width: 4),
          Text('$plan member', style: const TextStyle(color: Brand.teal, fontWeight: FontWeight.w600, fontSize: 13)),
        ]),
      );
}
