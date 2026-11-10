import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import 'post_card.dart';
import '../safety/report_screen.dart';

final _postProvider = FutureProvider.autoDispose.family<Post, String>((ref, id) => ref.watch(apiProvider).post(id));

/// A single post with its comments. Replies are one level deep (as in the API).
class PostScreen extends ConsumerStatefulWidget {
  const PostScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<PostScreen> createState() => _PostScreenState();
}

class _PostScreenState extends ConsumerState<PostScreen> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  Comment? _replyTo;
  bool _sending = false;

  Future<void> _send() async {
    final body = _ctrl.text.trim();
    if (body.isEmpty) return;
    setState(() => _sending = true);
    try {
      final c = await ref.read(apiProvider).addComment(widget.id, body, parentId: _replyTo?.id);
      _ctrl.clear();
      if (_replyTo == null) {
        ref.read(commentsProvider(widget.id).notifier).prepend(c);
      } else {
        ref.read(commentsProvider(widget.id).notifier).replaceWhere((x) => x.id == (c.parentId ?? ''), (x) => Comment(
              id: x.id, body: x.body, parentId: x.parentId, replyCount: x.replyCount + 1, author: x.author, createdAt: x.createdAt, isAuthor: x.isAuthor));
      }
      setState(() => _replyTo = null);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final post = ref.watch(_postProvider(widget.id));
    final comments = ref.watch(commentsProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Post')),
      body: post.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_postProvider(widget.id))),
        data: (p) => Column(children: [
          Expanded(
            child: NotificationListener<ScrollNotification>(
              onNotification: (n) {
                if (n.metrics.extentAfter < 400) ref.read(commentsProvider(widget.id).notifier).loadMoreSoon();
                return false;
              },
              child: ListView(children: [
                PostCard(post: p, onRemoved: () => context.pop()),
                const Divider(height: 1),
                for (final c in comments.items)
                  _CommentTile(
                    comment: c,
                    postAuthor: p.isAuthor,
                    onReply: () {
                      setState(() => _replyTo = c);
                      _focus.requestFocus();
                    },
                    onDeleted: () => ref.read(commentsProvider(widget.id).notifier).removeWhere((x) => x.id == c.id),
                  ),
                if (comments.loading) const LoadingView(),
                if (comments.loadedOnce && comments.items.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No comments yet. Say something nice.', textAlign: TextAlign.center)),
              ]),
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.line))),
              padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (_replyTo != null)
                  Row(children: [
                    Expanded(child: Text('Replying to ${_replyTo!.author.name ?? 'comment'}', style: const TextStyle(color: Brand.muted, fontSize: 12))),
                    IconButton(icon: const Icon(Icons.close, size: 16), onPressed: () => setState(() => _replyTo = null), tooltip: 'Cancel reply'),
                  ]),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _ctrl,
                      focusNode: _focus,
                      maxLength: 1000,
                      minLines: 1,
                      maxLines: 4,
                      decoration: const InputDecoration(hintText: 'Add a comment', counterText: '', border: InputBorder.none, filled: false),
                    ),
                  ),
                  IconButton(onPressed: _sending ? null : _send, icon: const Icon(Icons.send_rounded, color: Brand.teal), tooltip: 'Send'),
                ]),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

class _CommentTile extends ConsumerStatefulWidget {
  const _CommentTile({required this.comment, required this.postAuthor, required this.onReply, required this.onDeleted});
  final Comment comment;
  final bool postAuthor;
  final VoidCallback onReply;
  final VoidCallback onDeleted;
  @override
  ConsumerState<_CommentTile> createState() => _CommentTileState();
}

class _CommentTileState extends ConsumerState<_CommentTile> {
  List<Comment>? _replies;

  Future<void> _loadReplies() async {
    try {
      final page = await ref.read(apiProvider).replies(widget.comment.id);
      if (mounted) setState(() => _replies = page.items.reversed.toList());
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _options(Comment c) async {
    final api = ref.read(apiProvider);
    final canDelete = c.isAuthor || widget.postAuthor;
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (canDelete) ListTile(leading: const Icon(Icons.delete_outline), title: const Text('Delete comment'), onTap: () => Navigator.pop(ctx, 'delete')),
          if (!c.isAuthor) ListTile(leading: const Icon(Icons.flag_outlined), title: const Text('Report comment'), onTap: () => Navigator.pop(ctx, 'report')),
        ]),
      ),
    );
    if (!mounted || choice == null) return;
    try {
      if (choice == 'delete') {
        await api.deleteComment(c.id);
        if (c.id == widget.comment.id) {
          widget.onDeleted();
        } else {
          setState(() => _replies?.removeWhere((r) => r.id == c.id));
        }
      } else {
        await reportContent(context, 'COMMENT', c.id, 'comment');
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Widget _tile(Comment c, {bool reply = false}) => ListTile(
        contentPadding: EdgeInsets.only(left: reply ? 56 : 16, right: 8),
        leading: Avatar(url: c.author.avatarUrl, name: c.author.name, size: reply ? 28 : 36),
        title: Text.rich(TextSpan(children: [
          TextSpan(text: '${c.author.name ?? 'Someone'}  ', style: const TextStyle(fontWeight: FontWeight.w600)),
          TextSpan(text: c.body),
        ])),
        subtitle: Row(children: [
          Text(ago(c.createdAt)),
          if (!reply) TextButton(onPressed: widget.onReply, child: const Text('Reply')),
        ]),
        onLongPress: () => _options(c),
      );

  @override
  Widget build(BuildContext context) {
    final c = widget.comment;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _tile(c),
      if (_replies != null) for (final r in _replies!) _tile(r, reply: true),
      if (_replies == null && c.replyCount > 0)
        Padding(
          padding: const EdgeInsets.only(left: 64),
          child: TextButton(onPressed: _loadReplies, child: Text('View ${c.replyCount} ${c.replyCount == 1 ? 'reply' : 'replies'}')),
        ),
    ]);
  }
}
