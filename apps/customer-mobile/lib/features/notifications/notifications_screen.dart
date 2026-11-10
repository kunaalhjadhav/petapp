import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';

/// Where a notification leads. Shared with push taps.
String? routeFor(String? entityType, String? entityId) {
  if (entityId == null || entityId.isEmpty) return null;
  return switch (entityType) {
    'Post' || 'POST' => '/post/$entityId',
    'Pet' || 'PET' => '/pet/$entityId',
    'User' || 'USER' => '/user/$entityId',
    'Contest' => '/contest/$entityId',
    'Challenge' => '/challenge/$entityId',
    'Order' => '/order/$entityId',
    // Parcel updates: the order list (the notification carries the parcel, not the order).
    'SubOrder' => '/orders',
    'Badge' => '/me',
    'Booking' => '/booking/$entityId',
    'ServicePartner' => '/service-partner/$entityId',
    // A seller replied to your product review.
    'Product' => '/product/$entityId',
    // Money: a refund on a contest or challenge entry, a prize payout, a payout account checked by the bank.
    'Payment' => '/money',
    'Payout' => '/money/prizes',
    'PayoutAccount' => '/money/account',
    // A copy of their data is ready to download.
    'DataExport' => '/settings/privacy',
    // A chat message (push), and a reply or update from support.
    'Conversation' => '/messages/$entityId',
    'SupportTicket' => '/help/tickets/$entityId',
    // Phase 9d: a membership started, is ending or ended.
    'Membership' => '/membership',
    _ => null,
  };
}

/// A page inside the app that a promotion may open: a path like /shop, never another site.
bool safeAppLink(String? link) => link != null && RegExp(r'^/[a-z0-9][a-z0-9\-_/]{0,150}$').hasMatch(link);

/// Where a notification (or a push tap) leads: its app link when it has a safe one, else its entity.
String? notificationTarget(String? entityType, String? entityId, String? link) => safeAppLink(link) ? link : routeFor(entityType, entityId);

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool _marked = false;

  Future<void> _markAllRead() async {
    if (_marked) return;
    _marked = true;
    try {
      await ref.read(apiProvider).markRead();
      ref.invalidate(unreadCountProvider);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(notificationsProvider);
    final ctrl = ref.read(notificationsProvider.notifier);
    if (state.loadedOnce && state.items.isNotEmpty) Future.microtask(_markAllRead);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: !state.loadedOnce
          ? const LoadingView()
          : state.items.isEmpty && state.error != null
              ? ErrorView(error: state.error!, onRetry: ctrl.refresh)
              : RefreshIndicator(
                  onRefresh: () async {
                    _marked = false;
                    await ctrl.refresh();
                  },
                  child: state.items.isEmpty
                      ? ListView(children: const [SizedBox(height: 200), EmptyView(title: 'No notifications yet', message: 'Likes, comments, reminders and new followers will show up here.')])
                      : ListView.separated(
                          itemCount: state.items.length + 1,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (ctx, i) {
                            if (i == state.items.length) {
                              if (!state.done) ctrl.loadMoreSoon();
                              return state.done ? const SizedBox(height: 24) : const LoadingView();
                            }
                            return _Tile(n: state.items[i]);
                          },
                        ),
                ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.n});
  final AppNotification n;
  @override
  Widget build(BuildContext context) {
    final to = notificationTarget(n.entityType, n.entityId, n.link);
    return ListTile(
      tileColor: n.read ? null : const Color(0xFFEFF6F5),
      leading: n.actor != null ? Avatar(url: n.actor!.avatarUrl, name: n.actor!.name) : const CircleAvatar(backgroundColor: Color(0xFFDCEBE8), child: Icon(Icons.pets, color: Brand.teal)),
      title: Text(n.body),
      subtitle: Text(ago(n.at)),
      onTap: to == null ? null : () => context.push(to),
    );
  }
}
