import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/paged_controller.dart';
import '../../state/providers.dart';
import '../posts/post_card.dart';

/// Infinite list of posts with pull-to-refresh, used by feeds and hashtag pages.
class _PostList extends StatelessWidget {
  const _PostList({required this.state, required this.ctrl, required this.empty});
  final PagedState<Post> state;
  final PagedController<Post> ctrl;
  final Widget empty;

  @override
  Widget build(BuildContext context) {
    if (!state.loadedOnce) return const LoadingView();
    if (state.items.isEmpty && state.error != null) return ErrorView(error: state.error!, onRetry: ctrl.refresh);
    return RefreshIndicator(
      onRefresh: ctrl.refresh,
      child: state.items.isEmpty
          ? ListView(children: [SizedBox(height: MediaQuery.sizeOf(context).height * 0.6, child: empty)])
          : ListView.builder(
              itemCount: state.items.length + 1,
              itemBuilder: (ctx, i) {
                if (i >= state.items.length - 3) ctrl.loadMoreSoon();
                if (i == state.items.length) {
                  if (state.error != null) return ErrorView(error: state.error!, onRetry: ctrl.loadMore);
                  return state.done ? const SizedBox(height: 32) : const LoadingView();
                }
                final p = state.items[i];
                return PostCard(key: ValueKey(p.id), post: p, onRemoved: () => ctrl.removeWhere((x) => x.id == p.id));
              },
            ),
    );
  }
}

/// Posts for one hashtag.
class HashtagScreen extends ConsumerWidget {
  const HashtagScreen({super.key, required this.tag});
  final String tag;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: Text('#$tag')),
        body: _PostList(
          state: ref.watch(hashtagPostsProvider(tag)),
          ctrl: ref.read(hashtagPostsProvider(tag).notifier),
          empty: const EmptyView(title: 'No posts with this hashtag yet'),
        ),
      );
}
