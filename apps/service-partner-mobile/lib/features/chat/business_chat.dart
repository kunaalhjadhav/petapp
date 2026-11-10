import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/api_client.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../config.dart';
import '../../router.dart';
import '../../services/chat_socket.dart';
import '../../services/push_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../legal_markdown.dart';
import '../reviews/business_reviews.dart';
import 'chat_logic.dart';

// Chat with customers, and help & support (Phase 9a). The same file in the partner and seller apps: the API
// classes have the same chat methods, and AppConfig.chatInbox says which inbox this app shows.

final chatSocketProvider = Provider<ChatSocket>((ref) {
  final s = ChatSocket(() => ref.read(apiProvider).realtimeTicket());
  ref.onDispose(s.dispose);
  return s;
});

final chatEventsProvider = StreamProvider<ChatEvent>((ref) => ref.watch(chatSocketProvider).events);

/// Unread messages from customers, and replies from support.
final chatUnreadProvider = FutureProvider.autoDispose<({int chat, int support})>((ref) async {
  ref.listen(chatEventsProvider, (_, e) {
    final t = e.valueOrNull?.type;
    if (t == 'message' || t == 'read' || t == 'conversation') ref.invalidateSelf();
  });
  try {
    final u = await ref.watch(apiProvider).chatUnread();
    return (chat: AppConfig.chatInbox == 'partner' ? u.partner : u.seller, support: u.support);
  } catch (_) {
    return (chat: 0, support: 0);
  }
});

final _ticketsProvider = FutureProvider.autoDispose<List<SupportTicket>>((ref) => ref.watch(apiProvider).myTickets());
final _topicsProvider = FutureProvider.autoDispose<List<SupportTopic>>((ref) => ref.watch(apiProvider).supportTopics());
final _helpProvider = FutureProvider.autoDispose.family<HelpCenter, String>((ref, q) => ref.watch(apiProvider).helpCenter(q: q.isEmpty ? null : q));

Future<T?> _open<T>(BuildContext context, Widget page) => Navigator.of(context).push<T>(MaterialPageRoute<T>(builder: (_) => page));

/// Keeps the live connection open while the app is in front and signed in. Wrap the app with it.
class ChatLifecycle extends ConsumerStatefulWidget {
  const ChatLifecycle({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<ChatLifecycle> createState() => _ChatLifecycleState();
}

class _ChatLifecycleState extends ConsumerState<ChatLifecycle> {
  late final AppLifecycleListener _life;
  bool _foreground = true;

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(onResume: () => _set(true), onHide: () => _set(false));
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  @override
  void dispose() {
    _life.dispose();
    super.dispose();
  }

  void _set(bool v) {
    _foreground = v;
    _sync();
  }

  void _sync() {
    final s = ref.read(chatSocketProvider);
    if (_foreground && ref.read(authProvider).status == AuthStatus.signedIn) {
      s.start();
    } else {
      s.stop();
    }
  }

  /// A tapped push: open the conversation, ticket or reviews it is about.
  void _tapped(({String entityType, String entityId})? tap) {
    if (tap == null) return;
    ref.read(pushTapProvider.notifier).state = null;
    final ctx = ref.read(routerProvider).routerDelegate.navigatorKey.currentContext;
    if (ctx == null) return;
    if (tap.entityType == 'Conversation') unawaited(_open<void>(ctx, ConversationScreen(id: tap.entityId)));
    if (tap.entityType == 'SupportTicket') unawaited(openTicketThread(ctx, ref, tap.entityId));
    // A new review of your business (Phase 9b).
    if (tap.entityType == 'ProductReview' || tap.entityType == 'ServiceReview') unawaited(openReviews(ctx));
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authProvider, (_, __) => _sync());
    ref.listen(pushTapProvider, (_, tap) => _tapped(tap));
    return widget.child;
  }
}

/// App-bar button: messages from customers, with the unread count.
class MessagesButton extends ConsumerWidget {
  const MessagesButton({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(chatUnreadProvider).valueOrNull;
    final n = (u?.chat ?? 0) + (u?.support ?? 0);
    return IconButton(
      tooltip: 'Messages',
      onPressed: () => _open<void>(context, const MessagesScreen()),
      icon: Badge(isLabelVisible: n > 0, label: Text(n > 99 ? '99+' : '$n'), child: const Icon(Icons.chat_bubble_outline)),
    );
  }
}

/// Opens the conversation with the customer of a booking (partner app) or a parcel (seller app).
Future<void> openCustomerChat(BuildContext context, WidgetRef ref, String bookingOrParcelId) async {
  try {
    final s = await ref.read(apiProvider).startChat(bookingOrParcelId);
    if (!context.mounted) return;
    await _open<void>(context, ConversationScreen(id: s.conversation.id, offerRefType: s.refType, offerRefId: s.refId));
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

String _ago(DateTime? t) {
  if (t == null) return '';
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'now';
  if (d.inHours < 1) return '${d.inMinutes}m';
  if (d.inDays < 1) return '${d.inHours}h';
  if (d.inDays < 7) return '${d.inDays}d';
  return dayLabel(t.toLocal(), DateTime.now());
}

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
}

Widget _avatar(String name, {double size = 40}) => CircleAvatar(
      radius: size / 2,
      backgroundColor: const Color(0xFFDCEBE8),
      child: Text(_initials(name), style: TextStyle(fontSize: size * 0.38, color: Brand.teal, fontWeight: FontWeight.w600)),
    );

/// A photo for a chat or ticket: uploaded privately, then waited on until the server has prepared it.
Future<String> uploadChatPhoto(WidgetRef ref, XFile f) async {
  final api = ref.read(apiProvider);
  final ext = f.path.split('.').last.toLowerCase();
  final mime = switch (ext) { 'png' => 'image/png', 'webp' => 'image/webp', 'jpg' || 'jpeg' => 'image/jpeg', _ => '' };
  if (mime.isEmpty) throw ApiException(400, 'Send a JPEG, PNG or WebP photo.');
  final size = await f.length();
  final t = await api.createPhotoUpload(mime, size);
  try {
    // A plain client: the storage URL must not receive the app's Authorization header.
    await Dio().request<void>(t.url, data: File(f.path).openRead(), options: Options(method: t.method, headers: {...t.headers, Headers.contentLengthHeader: size}));
  } on DioException {
    throw ApiException(0, 'The photo didn’t upload. Check your connection and try again.');
  }
  await api.completeUpload(t.mediaId);
  for (var i = 0; i < 60; i++) {
    final s = await api.photoStatus(t.mediaId);
    if (s == 'READY') return t.mediaId;
    if (s == 'FAILED' || s == 'REJECTED') break;
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }
  throw ApiException(400, 'This photo couldn’t be used. Try another.');
}

/// Conversations with customers.
class MessagesScreen extends ConsumerStatefulWidget {
  const MessagesScreen({super.key});
  @override
  ConsumerState<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends ConsumerState<MessagesScreen> {
  final _items = <ChatConversation>[];
  String? _cursor;
  bool _loading = true;
  bool _done = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load(reset: true));
  }

  Future<void> _load({bool reset = false}) async {
    if (!reset && (_done || _loading)) return;
    setState(() => _loading = true);
    try {
      final p = await ref.read(apiProvider).conversations(cursor: reset ? null : _cursor);
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(p.items);
        _cursor = p.nextCursor;
        _done = p.nextCursor == null;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(chatEventsProvider, (_, e) {
      final t = e.valueOrNull?.type;
      if (t == 'message' || t == 'read' || t == 'hello') unawaited(_load(reset: true));
    });
    final support = ref.watch(chatUnreadProvider).valueOrNull?.support ?? 0;
    return Scaffold(
      appBar: AppBar(title: const Text('Messages'), actions: [
        IconButton(
          tooltip: 'Help & support',
          icon: Badge(isLabelVisible: support > 0, label: Text('$support'), child: const Icon(Icons.help_outline)),
          onPressed: () => _open<void>(context, const HelpScreen()),
        ),
      ]),
      body: RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: _items.isEmpty
            ? ListView(children: [
                if (_loading)
                  const LoadingView()
                else if (_error != null)
                  ErrorView(error: _error!, onRetry: () => _load(reset: true))
                else
                  const EmptyView(title: 'No messages yet', message: 'Customers can message you from your page, and about their bookings and orders.'),
              ])
            : ListView.separated(
                itemCount: _items.length + (_done ? 0 : 1),
                separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
                itemBuilder: (context, i) {
                  if (i == _items.length) {
                    unawaited(Future.microtask(_load)); // not during build
                    return const LoadingView();
                  }
                  final c = _items[i];
                  return ListTile(
                    leading: _avatar(c.counterpart.name, size: 44),
                    title: Text(c.counterpart.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: c.unread > 0 ? FontWeight.w700 : FontWeight.w500)),
                    subtitle: Text(c.blocked ? 'Blocked' : (c.lastMessageText ?? ''), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: c.unread > 0 ? Brand.ink : Brand.muted)),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text(_ago(c.lastMessageAt), style: const TextStyle(color: Brand.muted, fontSize: 12)),
                      if (c.unread > 0) ...[
                        const SizedBox(height: 4),
                        CircleAvatar(radius: 10, backgroundColor: Brand.teal, child: Text(c.unread > 99 ? '99+' : '${c.unread}', style: const TextStyle(color: Colors.white, fontSize: 10))),
                      ],
                    ]),
                    onTap: () async {
                      await _open<void>(context, ConversationScreen(id: c.id));
                      unawaited(_load(reset: true));
                    },
                  );
                },
              ),
      ),
    );
  }
}

const _reasons = {
  'SPAM': 'Spam or a scam',
  'ABUSE': 'Abuse or harassment',
  'ANIMAL_WELFARE': 'An animal may be at risk',
  'OTHER': 'Something else',
};

/// One conversation with a customer, or a support ticket's thread.
class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({super.key, required this.id, this.offerRefType, this.offerRefId});
  final String id;
  final String? offerRefType;
  final String? offerRefId;
  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  ChatHeader? _header;
  List<ChatMessage> _messages = [];
  String? _olderCursor;
  bool _loadingOlder = false;
  Object? _error;
  bool _offer = false;
  DateTime? _typingUntil;
  DateTime _lastTypingSent = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _readSoon;

  @override
  void initState() {
    super.initState();
    _offer = widget.offerRefType != null;
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) unawaited(_loadOlder());
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    _readSoon?.cancel();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    try {
      final h = await api.conversation(widget.id);
      final page = await api.chatMessages(widget.id);
      if (!mounted) return;
      setState(() {
        _header = h;
        _messages = mergeMessages(_messages, page.items);
        _olderCursor = page.nextCursor;
        _error = null;
      });
      _markRead();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _loadOlder() async {
    if (_loadingOlder || _olderCursor == null) return;
    _loadingOlder = true;
    try {
      final p = await ref.read(apiProvider).chatMessages(widget.id, before: _olderCursor);
      if (mounted) {
        setState(() {
          _messages = mergeMessages(_messages, p.items);
          _olderCursor = p.nextCursor;
        });
      }
    } catch (_) {
      // Scrolling up again retries.
    } finally {
      _loadingOlder = false;
    }
  }

  Future<void> _catchUp() async {
    final sent = _messages.where((m) => !m.id.startsWith('local:')).toList();
    if (sent.isEmpty) {
      unawaited(_load());
      return;
    }
    var cursor = afterCursor(sent.last);
    for (var i = 0; i < 10; i++) {
      final p = await ref.read(apiProvider).chatMessages(widget.id, after: cursor);
      if (!mounted) return;
      setState(() => _messages = mergeMessages(_messages, p.items));
      if (!p.more || p.nextCursor == null) break;
      cursor = p.nextCursor!;
    }
    _markRead();
    final h = await ref.read(apiProvider).conversation(widget.id);
    if (mounted) setState(() => _header = h);
  }

  void _markRead() {
    _readSoon?.cancel();
    _readSoon = Timer(const Duration(milliseconds: 400), () => unawaited(ref.read(apiProvider).markChatRead(widget.id).catchError((Object _) {})));
  }

  void _onEvent(ChatEvent e) {
    if (e.type == 'hello') {
      unawaited(_catchUp());
      return;
    }
    final h = _header;
    if (e.conversationId != widget.id || h == null) return;
    switch (e.type) {
      case 'message':
        final m = e.message!.forSide(h.side);
        setState(() {
          _messages = mergeMessages(_messages, [m]);
          if (!m.mine) _typingUntil = null;
        });
        if (!m.mine) _markRead();
      case 'read':
        if (e.side != h.side && e.at != null) {
          setState(() => _header = ChatHeader(
                id: h.id, kind: h.kind, status: h.status, side: h.side, counterpart: h.counterpart, canSend: h.canSend, cannotSendReason: h.cannotSendReason,
                blockedByMe: h.blockedByMe, unread: 0, otherReadAt: e.at, ticket: h.ticket,
              ));
        }
      case 'typing':
        if (e.side != h.side) {
          setState(() => _typingUntil = DateTime.now().add(const Duration(seconds: 4)));
          unawaited(Future<void>.delayed(const Duration(seconds: 4, milliseconds: 100), () {
            if (mounted) setState(() {});
          }));
        }
      case 'conversation':
        unawaited(_load());
    }
  }

  void _typed(String _) {
    if (DateTime.now().difference(_lastTypingSent) < const Duration(seconds: 3)) return;
    _lastTypingSent = DateTime.now();
    ref.read(chatSocketProvider).typing(widget.id);
  }

  ChatMessage _local(String clientId, {String? body, String? path, ChatRef? card}) => ChatMessage(
        id: 'local:$clientId', side: _header?.side ?? 'BUSINESS', mine: true, body: body, removed: false, ref: card, clientId: clientId,
        createdAt: DateTime.now(), sending: true, localPath: path,
      );

  Future<void> _send({String? body, String? refType, String? refId, ChatMessage? retry}) async {
    final clientId = retry?.clientId ?? newClientId();
    setState(() => _messages = mergeMessages(_messages, [
          retry?.copyWith(sending: true, failed: false) ?? _local(clientId, body: body, card: refType != null ? ChatRef(type: refType, id: refId!, title: 'Sending…') : null),
        ]));
    try {
      final m = await ref.read(apiProvider).sendChat(widget.id, clientId: clientId, body: body ?? retry?.body, refType: refType ?? retry?.ref?.type, refId: refId ?? retry?.ref?.id);
      if (mounted) setState(() => _messages = mergeMessages(_messages, [m]));
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages = [for (final x in _messages) x.clientId == clientId && x.id.startsWith('local:') ? x.copyWith(sending: false, failed: true) : x]);
      final err = ApiException.from(e);
      if (err.status == 403) unawaited(_load());
      if (err.status != 0) showError(context, e);
    }
  }

  Future<void> _sendText() async {
    final body = _text.text.trim();
    if (body.isEmpty) return;
    _text.clear();
    await _send(body: body);
  }

  Future<void> _sendPhoto() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2400, imageQuality: 85);
    if (f == null) return;
    final clientId = newClientId();
    setState(() => _messages = mergeMessages(_messages, [_local(clientId, path: f.path)]));
    try {
      final mediaId = await uploadChatPhoto(ref, f);
      final m = await ref.read(apiProvider).sendChat(widget.id, clientId: clientId, mediaId: mediaId);
      if (mounted) setState(() => _messages = mergeMessages(_messages.where((x) => x.clientId != clientId).toList(), [m]));
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages = _messages.where((x) => x.clientId != clientId).toList());
      showError(context, e);
    }
  }

  Future<void> _block(bool on) async {
    final h = _header;
    if (h == null) return;
    if (on) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Block ${h.counterpart.name}?'),
          content: const Text('Neither of you can send messages here. Bookings and orders aren’t affected. You can unblock later.'),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Block'))],
        ),
      );
      if (ok != true) return;
    }
    try {
      final nh = await ref.read(apiProvider).blockChat(h.id, on);
      if (mounted) setState(() => _header = nh);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _actions(ChatMessage m) async {
    final reportable = !m.mine && !m.removed && !m.isSystem && m.side != 'STAFF' && !m.id.startsWith('local:');
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (m.body != null) ListTile(leading: const Icon(Icons.copy), title: const Text('Copy'), onTap: () => Navigator.pop(ctx, 'copy')),
          if (reportable) ListTile(leading: const Icon(Icons.flag_outlined), title: const Text('Report'), onTap: () => Navigator.pop(ctx, 'report')),
          if (m.failed) ListTile(leading: const Icon(Icons.refresh), title: const Text('Try again'), onTap: () => Navigator.pop(ctx, 'retry')),
        ]),
      ),
    );
    if (!mounted || choice == null) return;
    if (choice == 'copy') {
      await Clipboard.setData(ClipboardData(text: m.body!));
      if (mounted) showMessage(context, 'Copied');
    } else if (choice == 'retry') {
      await _send(retry: m);
    } else if (choice == 'report') {
      final reason = await showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (ctx) => SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const ListTile(title: Text('Why are you reporting this message?', style: TextStyle(fontWeight: FontWeight.w700))),
            for (final e in _reasons.entries) ListTile(title: Text(e.value), onTap: () => Navigator.pop(ctx, e.key)),
          ]),
        ),
      );
      if (reason == null) return;
      try {
        await ref.read(apiProvider).reportMessage(m.id, reason);
        if (mounted) showMessage(context, 'Thanks. Our team will review this message.');
      } catch (e) {
        if (mounted) showError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(chatEventsProvider, (_, e) {
      final ev = e.valueOrNull;
      if (ev != null) _onEvent(ev);
    });
    final h = _header;
    if (h == null) return Scaffold(appBar: AppBar(), body: _error != null ? ErrorView(error: _error!, onRetry: _load) : const LoadingView());
    final typing = _typingUntil != null && DateTime.now().isBefore(_typingUntil!);
    final subtitle = typing ? 'typing…' : h.isSupport ? '${h.ticket?.code ?? ''} · ${h.ticket?.subject ?? ''}' : 'Customer';
    final seen = seenText(_messages, h.otherReadAt);
    final shown = _messages.reversed.toList();
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(children: [
          h.isSupport ? const CircleAvatar(radius: 18, backgroundColor: Color(0xFFDCEBE8), child: Icon(Icons.support_agent, color: Brand.teal, size: 20)) : _avatar(h.counterpart.name, size: 36),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(h.counterpart.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: typing ? Brand.teal : Brand.muted)),
            ]),
          ),
        ]),
        actions: [
          if (!h.isSupport)
            PopupMenuButton<String>(
              onSelected: (v) => _block(v == 'block'),
              itemBuilder: (_) => [PopupMenuItem(value: h.blockedByMe ? 'unblock' : 'block', child: Text(h.blockedByMe ? 'Unblock' : 'Block'))],
            ),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: _messages.isEmpty
              ? const EmptyView(title: 'No messages yet', message: 'Be kind and clear: messages can be reported.')
              : ListView.builder(
                  controller: _scroll,
                  reverse: true,
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  itemCount: shown.length + (seen != null ? 1 : 0),
                  itemBuilder: (context, index) {
                    var i = index;
                    if (seen != null) {
                      if (i == 0) return Align(alignment: Alignment.centerRight, child: Padding(padding: const EdgeInsets.only(right: 4, bottom: 4), child: Text(seen, style: const TextStyle(fontSize: 11, color: Brand.muted))));
                      i -= 1;
                    }
                    final m = shown[i];
                    final prev = i + 1 < shown.length ? shown[i + 1] : null;
                    return Column(children: [
                      if (needsDayDivider(prev, m))
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          child: Text(dayLabel(m.createdAt.toLocal(), DateTime.now()), style: const TextStyle(fontSize: 12, color: Brand.muted, fontWeight: FontWeight.w600)),
                        ),
                      _Bubble(message: m, onLongPress: () => _actions(m), onRetry: m.failed ? () => _send(retry: m) : null),
                    ]);
                  },
                ),
        ),
        if (_offer && h.canSend)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
            child: Row(children: [
              Expanded(
                child: ActionChip(
                  avatar: const Icon(Icons.add_link, size: 18),
                  label: Text('Share this ${widget.offerRefType == 'BOOKING' ? 'booking' : widget.offerRefType == 'ORDER' ? 'order' : 'product'}'),
                  onPressed: () {
                    setState(() => _offer = false);
                    unawaited(_send(refType: widget.offerRefType, refId: widget.offerRefId));
                  },
                ),
              ),
              IconButton(tooltip: 'Not now', icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _offer = false)),
            ]),
          ),
        if (!h.canSend)
          Container(
            width: double.infinity,
            color: const Color(0xFFF3ECE3),
            padding: const EdgeInsets.all(14),
            child: SafeArea(
              top: false,
              child: Row(children: [
                Expanded(child: Text(h.cannotSendReason ?? 'You can’t send messages here.', style: const TextStyle(color: Brand.muted))),
                if (h.blockedByMe) TextButton(onPressed: () => _block(false), child: const Text('Unblock')),
              ]),
            ),
          )
        else
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(4, 4, 8, 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                IconButton(tooltip: 'Send a photo', icon: const Icon(Icons.photo_outlined), onPressed: _sendPhoto),
                Expanded(
                  child: TextField(
                    controller: _text,
                    onChanged: _typed,
                    minLines: 1,
                    maxLines: 5,
                    maxLength: 2000,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(hintText: 'Message', counterText: '', isDense: true, border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(20)))),
                  ),
                ),
                const SizedBox(width: 4),
                IconButton.filled(tooltip: 'Send', icon: const Icon(Icons.send_rounded), onPressed: _sendText),
              ]),
            ),
          ),
      ]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, this.onLongPress, this.onRetry});
  final ChatMessage message;
  final VoidCallback? onLongPress;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final m = message;
    if (m.isSystem) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 24),
        child: Text(m.body ?? '', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Brand.muted)),
      );
    }
    final mine = m.mine;
    final img = m.media?.imageFor(480);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        onTap: m.failed ? onRetry : null,
        child: Container(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
          margin: const EdgeInsets.symmetric(vertical: 2),
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
          decoration: BoxDecoration(
            color: mine ? Brand.teal : m.side == 'STAFF' ? const Color(0xFFDCEBE8) : Colors.white,
            border: mine ? null : Border.all(color: Brand.line),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: Radius.circular(mine ? 16 : 4),
              bottomRight: Radius.circular(mine ? 4 : 16),
            ),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            if (m.side == 'STAFF' && !mine) Text('${m.senderName ?? 'Support'} · PetApp Support', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Brand.teal)),
            if (m.removed)
              Text('This message was removed', style: TextStyle(fontStyle: FontStyle.italic, color: mine ? Colors.white70 : Brand.muted))
            else ...[
              if (m.localPath != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Stack(alignment: Alignment.center, children: [
                    ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.file(File(m.localPath!), width: 220, fit: BoxFit.cover)),
                    const CircularProgressIndicator(),
                  ]),
                )
              else if (img != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: GestureDetector(
                    onTap: () => _open<void>(
                      context,
                      Scaffold(
                        backgroundColor: Colors.black,
                        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white),
                        body: Center(child: InteractiveViewer(child: Image.network(m.media!.imageFor(1080) ?? img))),
                      ),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: AspectRatio(aspectRatio: m.media!.aspectRatio.clamp(0.6, 1.8), child: Image.network(img, fit: BoxFit.cover)),
                    ),
                  ),
                ),
              if (m.ref != null) _RefCard(r: m.ref!, onDark: mine),
              if (m.body != null && m.body!.isNotEmpty) SelectableText(m.body!, style: TextStyle(color: mine ? Colors.white : Brand.ink, fontSize: 15, height: 1.3)),
            ],
            const SizedBox(height: 2),
            Text(
              m.failed ? 'Not sent · tap to retry' : m.sending ? 'Sending…' : timeLabel(m.createdAt.toLocal()),
              style: TextStyle(fontSize: 10, color: m.failed ? const Color(0xFFFFD2C2) : mine ? Colors.white70 : Brand.muted),
            ),
          ]),
        ),
      ),
    );
  }
}

class _RefCard extends StatelessWidget {
  const _RefCard({required this.r, required this.onDark});
  final ChatRef r;
  final bool onDark;
  @override
  Widget build(BuildContext context) {
    final lines = refLines(r);
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: onDark ? const Color(0x1FFFFFFF) : const Color(0xFFF7F2EB), borderRadius: BorderRadius.circular(10)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: r.imageUrl != null
              ? ClipRRect(borderRadius: BorderRadius.circular(6), child: Image.network(r.imageUrl!, width: 44, height: 44, fit: BoxFit.cover))
              : Icon(r.type == 'BOOKING' ? Icons.event_available_outlined : r.type == 'ORDER' ? Icons.local_shipping_outlined : Icons.shopping_bag_outlined, color: onDark ? Colors.white : Brand.teal),
        ),
        Flexible(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(lines.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, color: onDark ? Colors.white : Brand.ink)),
            if (lines.subtitle.isNotEmpty) Text(lines.subtitle, style: TextStyle(fontSize: 12, color: onDark ? Colors.white70 : Brand.muted)),
          ]),
        ),
      ]),
    );
  }
}

// ───────────── help & support ─────────────

/// Help & support: answers first, then writing to the PetApp team.
class HelpScreen extends ConsumerStatefulWidget {
  const HelpScreen({super.key});
  @override
  ConsumerState<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends ConsumerState<HelpScreen> {
  String _q = '';
  Timer? _debounce;
  final _voted = <String>{};

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final help = ref.watch(_helpProvider(_q));
    final tickets = ref.watch(_ticketsProvider).valueOrNull ?? const <SupportTicket>[];
    final open = tickets.where((t) => t.open).length;
    return Scaffold(
      appBar: AppBar(title: const Text('Help & support')),
      body: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search help', border: OutlineInputBorder(), isDense: true),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () => setState(() => _q = v.trim()));
            },
          ),
        ),
        if (tickets.isNotEmpty)
          ListTile(
            leading: const Icon(Icons.forum_outlined, color: Brand.teal),
            title: const Text('Your tickets'),
            subtitle: Text(open == 0 ? 'All answered' : '$open open'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              await _open<void>(context, const TicketsScreen());
              ref.invalidate(_ticketsProvider);
            },
          ),
        help.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_helpProvider(_q))),
          data: (h) => Column(children: [
            if (h.faqs.isEmpty)
              Padding(padding: const EdgeInsets.all(24), child: Text(_q.isEmpty ? 'No answers here yet. Write to us below.' : 'Nothing matches “$_q”. Write to us below.', style: const TextStyle(color: Brand.muted))),
            for (final f in h.faqs)
              ExpansionTile(
                title: Text(f.question, style: const TextStyle(fontWeight: FontWeight.w600)),
                childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                expandedCrossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LegalMarkdown(f.answer),
                  const SizedBox(height: 8),
                  if (_voted.contains(f.id))
                    const Text('Thanks for letting us know.', style: TextStyle(color: Brand.muted, fontSize: 12))
                  else
                    Row(children: [
                      const Text('Did this help?', style: TextStyle(color: Brand.muted, fontSize: 12)),
                      TextButton(onPressed: () => _vote(f.id, true), child: const Text('Yes')),
                      TextButton(onPressed: () => _vote(f.id, false), child: const Text('No')),
                    ]),
                ],
              ),
          ]),
        ),
        const Divider(height: 32),
        const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('Still need help?', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
        const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 12), child: Text('Write to the PetApp team. We reply here.', style: TextStyle(color: Brand.muted))),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: FilledButton.icon(
            icon: const Icon(Icons.mail_outline),
            label: const Text('Contact support'),
            onPressed: () async {
              await _open<void>(context, const NewTicketScreen());
              ref.invalidate(_ticketsProvider);
            },
          ),
        ),
      ]),
    );
  }

  Future<void> _vote(String id, bool helpful) async {
    setState(() => _voted.add(id));
    try {
      await ref.read(apiProvider).faqFeedback(id, helpful);
    } catch (_) {
      // Feedback is a nicety; never bother anyone with a failure.
    }
  }
}

class NewTicketScreen extends ConsumerStatefulWidget {
  const NewTicketScreen({super.key, this.refType, this.refId, this.refLabel});
  final String? refType;
  final String? refId;
  final String? refLabel;
  @override
  ConsumerState<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends ConsumerState<NewTicketScreen> {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  final _photos = <XFile>[];
  String? _topic;
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_topic == null || _subject.text.trim().length < 3 || _body.text.trim().isEmpty) {
      showMessage(context, 'Choose a topic, and write a subject and a message.');
      return;
    }
    setState(() => _busy = true);
    try {
      final ids = <String>[for (final p in _photos) await uploadChatPhoto(ref, p)];
      final t = await ref.read(apiProvider).openTicket(categoryId: _topic!, subject: _subject.text.trim(), body: _body.text.trim(), mediaIds: ids, refType: widget.refType, refId: widget.refId);
      if (!mounted) return;
      showMessage(context, 'Sent. Your ticket is ${t.code}; we’ll reply here.');
      unawaited(Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => ConversationScreen(id: t.conversationId))));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final topics = ref.watch(_topicsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Contact support')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        topics.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_topicsProvider)),
          data: (list) => DropdownButtonFormField<String>(
            value: _topic,
            decoration: const InputDecoration(labelText: 'What’s it about?', border: OutlineInputBorder()),
            items: [for (final t in list) DropdownMenuItem(value: t.id, child: Text(t.name))],
            onChanged: (v) => setState(() => _topic = v),
          ),
        ),
        if (widget.refLabel != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('About ${widget.refLabel}', style: const TextStyle(color: Brand.muted))),
        const SizedBox(height: 12),
        TextField(controller: _subject, maxLength: 120, decoration: const InputDecoration(labelText: 'Subject', border: OutlineInputBorder())),
        const SizedBox(height: 4),
        TextField(
          controller: _body,
          minLines: 5,
          maxLines: 12,
          maxLength: 2000,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(labelText: 'Tell us what happened', alignLabelWithHint: true, border: OutlineInputBorder()),
        ),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in _photos)
            GestureDetector(
              onTap: () => setState(() => _photos.remove(p)),
              child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.file(File(p.path), width: 72, height: 72, fit: BoxFit.cover)),
            ),
          if (_photos.length < 5)
            OutlinedButton.icon(
              onPressed: () async {
                final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2400, imageQuality: 85);
                if (f != null && mounted) setState(() => _photos.add(f));
              },
              icon: const Icon(Icons.add_photo_alternate_outlined),
              label: const Text('Add a photo'),
            ),
        ]),
        const SizedBox(height: 8),
        const Text('Photos are only seen by the PetApp team. Tap a photo to remove it.', style: TextStyle(color: Brand.muted, fontSize: 12)),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _submit, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Send')),
      ]),
    );
  }
}

class TicketsScreen extends ConsumerWidget {
  const TicketsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(_ticketsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Your tickets')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(_ticketsProvider),
        child: tickets.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_ticketsProvider)),
          data: (list) => list.isEmpty
              ? ListView(children: const [EmptyView(title: 'No tickets', message: 'When you write to support, your conversations appear here.')])
              : ListView.separated(
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final t = list[i];
                    return ListTile(
                      title: Text(t.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: t.unread > 0 ? FontWeight.w700 : FontWeight.w500)),
                      subtitle: Text('${t.code} · ${t.statusLabel}\n${t.lastMessageText ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis),
                      isThreeLine: true,
                      trailing: Text(_ago(t.lastMessageAt), style: const TextStyle(color: Brand.muted, fontSize: 12)),
                      onTap: () async {
                        await _open<void>(context, ConversationScreen(id: t.conversationId));
                        ref.invalidate(_ticketsProvider);
                      },
                    );
                  },
                ),
        ),
      ),
    );
  }
}

/// Opens a ticket's conversation (from a push notification, which carries the ticket).
Future<void> openTicketThread(BuildContext context, WidgetRef ref, String ticketId) async {
  try {
    final t = await ref.read(apiProvider).ticket(ticketId);
    if (context.mounted) await _open<void>(context, ConversationScreen(id: t.conversationId));
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

/// Business-tab entries: messages and help.
class ChatAndHelpTiles extends ConsumerWidget {
  const ChatAndHelpTiles({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(chatUnreadProvider).valueOrNull;
    return Column(children: [
      ListTile(
        leading: const Icon(Icons.chat_bubble_outline),
        title: const Text('Messages'),
        subtitle: Text((u?.chat ?? 0) > 0 ? '${u!.chat} unread' : 'Conversations with customers'),
        onTap: () => _open<void>(context, const MessagesScreen()),
      ),
      ListTile(
        leading: const Icon(Icons.help_outline),
        title: const Text('Help & support'),
        subtitle: Text((u?.support ?? 0) > 0 ? '${u!.support} new from support' : 'Answers, and writing to the PetApp team'),
        onTap: () => _open<void>(context, const HelpScreen()),
      ),
    ]);
  }
}
