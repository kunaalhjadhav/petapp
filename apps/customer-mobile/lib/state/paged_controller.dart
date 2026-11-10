import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/models.dart';

class PagedState<T> {
  const PagedState({this.items = const [], this.cursor, this.loading = false, this.done = false, this.error, this.loadedOnce = false});
  final List<T> items;
  final String? cursor;
  final bool loading;
  final bool done;
  final ApiException? error;
  final bool loadedOnce;

  PagedState<T> copyWith({List<T>? items, String? cursor, bool? loading, bool? done, ApiException? error, bool clearError = false, bool? loadedOnce}) =>
      PagedState(
        items: items ?? this.items,
        cursor: cursor ?? this.cursor,
        loading: loading ?? this.loading,
        done: done ?? this.done,
        error: clearError ? null : (error ?? this.error),
        loadedOnce: loadedOnce ?? this.loadedOnce,
      );
}

/// Cursor-paged list: first page on creation, `loadMore` near the end, pull-to-refresh.
class PagedController<T> extends StateNotifier<PagedState<T>> {
  PagedController(this._load) : super(PagedState<T>()) {
    loadMore();
  }

  final Future<CursorPage<T>> Function(String? cursor) _load;
  int _generation = 0;

  Future<void> loadMore() async {
    if (state.loading || state.done) return;
    final gen = _generation;
    state = state.copyWith(loading: true, clearError: true);
    try {
      final page = await _load(state.cursor);
      if (!mounted || gen != _generation) return; // a refresh started meanwhile
      state = state.copyWith(
        items: [...state.items, ...page.items],
        cursor: page.nextCursor,
        done: page.nextCursor == null,
        loading: false,
        loadedOnce: true,
      );
    } catch (e) {
      if (!mounted || gen != _generation) return;
      state = state.copyWith(loading: false, error: ApiException.from(e), loadedOnce: true);
    }
  }

  /// Safe to call from a build method: the state change happens after the current frame builds.
  void loadMoreSoon() {
    if (state.loading || state.done) return;
    Future.microtask(loadMore);
  }

  Future<void> refresh() async {
    _generation++;
    state = PagedState<T>();
    await loadMore();
  }

  void replaceWhere(bool Function(T) test, T Function(T) update) {
    state = state.copyWith(items: [for (final i in state.items) test(i) ? update(i) : i]);
  }

  void removeWhere(bool Function(T) test) => state = state.copyWith(items: state.items.where((i) => !test(i)).toList());

  void prepend(T item) => state = state.copyWith(items: [item, ...state.items]);
}
