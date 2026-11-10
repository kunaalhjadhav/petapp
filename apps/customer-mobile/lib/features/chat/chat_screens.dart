import 'dart:async';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/api_client.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/chat_socket.dart';
import '../../services/upload_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import 'chat_logic.dart';
import '../safety/report_screen.dart';

final chatEnabledProvider = Provider<bool>((ref) => ref.watch(flagsProvider).valueOrNull?['ENABLE_CHAT'] ?? false);

/// Unread messages (chat and support), refreshed whenever something arrives live.
final chatUnreadProvider = FutureProvider.autoDispose<ChatUnread>((ref) async {
  ref.listen(chatEventsProvider, (_, e) {
    final t = e.valueOrNull?.type;
    if (t == 'message' || t == 'read' || t == 'conversation') ref.invalidateSelf();
  });
  try {
    return await ref.watch(apiProvider).chatUnread();
  } catch (_) {
    return ChatUnread(customer: 0, partner: 0, seller: 0, support: 0);
  }
});

/// Opens the conversation with a partner, a seller about a product, or about a booking or order.
Future<void> openChat(BuildContext context, WidgetRef ref, {String? partnerId, String? productId, String? bookingId, String? subOrderId}) async {
  try {
    final s = await ref.read(apiProvider).startChat(partnerId: partnerId, productId: productId, bookingId: bookingId, subOrderId: subOrderId);
    if (!context.mounted) return;
    final q = s.refType != null ? '?ref=${s.refType}&refId=${s.refId}' : '';
    await context.push('/messages/${s.conversation.id}$q');
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

/// The Messages list: conversations with partners and sellers.
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
    if (!reset && (_done || _loading && _items.isNotEmpty)) return;
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
    return Scaffold(
      appBar: AppBar(title: const Text('Messages'), actions: [
        IconButton(tooltip: 'Help & support', icon: const Icon(Icons.help_outline), onPressed: () => context.push('/help')),
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
                  const EmptyView(title: 'No messages yet', message: 'Message a groomer, vet or trainer from their page, or ask a seller about a product.'),
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
                    leading: Avatar(url: c.counterpart.avatarUrl, name: c.counterpart.name, size: 44),
                    title: Text(c.counterpart.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: c.unread > 0 ? FontWeight.w700 : FontWeight.w500)),
                    subtitle: Text(
                      c.blocked ? 'Blocked' : (c.lastMessageText ?? ''),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: c.unread > 0 ? Brand.ink : Brand.muted),
                    ),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text(ago(c.lastMessageAt), style: const TextStyle(color: Brand.muted, fontSize: 12)),
                      if (c.unread > 0) ...[const SizedBox(height: 4), _Badge(c.unread)],
                    ]),
                    onTap: () async {
                      await context.push('/messages/${c.id}');
                      unawaited(_load(reset: true));
                    },
                  );
                },
              ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.n);
  final int n;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(color: Brand.teal, borderRadius: BorderRadius.circular(10)),
        child: Text(n > 99 ? '99+' : '$n', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
      );
}

/// One conversation: with a partner, a seller, or PetApp Support (a ticket's thread).
class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({super.key, required this.id, this.offerRefType, this.offerRefId});
  final String id;

  /// Opened from a product, booking or order page: offer to share that card.
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
      final results = await Future.wait([api.conversation(widget.id), api.chatMessages(widget.id)]);
      if (!mounted) return;
      final page = results[1] as ChatPage;
      setState(() {
        _header = results[0] as ChatHeader;
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
      if (mounted) setState(() {
        _messages = mergeMessages(_messages, p.items);
        _olderCursor = p.nextCursor;
      });
    } catch (_) {
      // Scrolling up again retries.
    } finally {
      _loadingOlder = false;
    }
  }

  /// After reconnecting: everything newer than the newest message shown.
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
    if (e.conversationId != widget.id || _header == null) return;
    switch (e.type) {
      case 'message':
        final m = e.message!.forSide(_header!.side);
        setState(() {
          _messages = mergeMessages(_messages, [m]);
          if (!m.mine) _typingUntil = null;
        });
        if (!m.mine) _markRead();
      case 'read':
        if (e.side != _header!.side && e.at != null) setState(() => _header = _withRead(_header!, e.at!));
      case 'typing':
        if (e.side != _header!.side) {
          setState(() => _typingUntil = DateTime.now().add(const Duration(seconds: 4)));
          unawaited(Future<void>.delayed(const Duration(seconds: 4, milliseconds: 100), () {
            if (mounted) setState(() {});
          }));
        }
      case 'conversation':
        unawaited(_load());
    }
  }

  ChatHeader _withRead(ChatHeader h, DateTime at) => ChatHeader(
        id: h.id, kind: h.kind, status: h.status, side: h.side, counterpart: h.counterpart, canSend: h.canSend, cannotSendReason: h.cannotSendReason,
        blockedByMe: h.blockedByMe, unread: 0, otherReadAt: at, ticket: h.ticket,
      );

  void _typed(String _) {
    if (DateTime.now().difference(_lastTypingSent) < const Duration(seconds: 3)) return;
    _lastTypingSent = DateTime.now();
    ref.read(chatSocketProvider).typing(widget.id);
  }

  ChatMessage _local(String clientId, {String? body, String? path, ChatRef? card}) => ChatMessage(
        id: 'local:$clientId', side: _header?.side ?? 'CUSTOMER', mine: true, body: body, removed: false, ref: card, clientId: clientId,
        createdAt: DateTime.now(), sending: true, localPath: path,
      );

  Future<void> _send({String? body, String? refType, String? refId, ChatMessage? retry}) async {
    final clientId = retry?.clientId ?? newClientId();
    if (retry == null) setState(() => _messages = mergeMessages(_messages, [_local(clientId, body: body, card: refType != null ? ChatRef(type: refType, id: refId!, title: 'Sending…') : null)]));
    if (retry != null) setState(() => _messages = mergeMessages(_messages, [retry.copyWith(sending: true, failed: false)]));
    try {
      final m = await ref.read(apiProvider).sendChat(widget.id, clientId: clientId, body: body ?? retry?.body, refType: refType ?? retry?.ref?.type, refId: refId ?? retry?.ref?.id);
      if (mounted) setState(() => _messages = mergeMessages(_messages, [m]));
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages = [for (final x in _messages) x.clientId == clientId && x.id.startsWith('local:') ? x.copyWith(sending: false, failed: true) : x]);
      final err = ApiException.from(e);
      if (err.status == 403) unawaited(_load()); // blocked or closed meanwhile: show why
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
      final mediaId = await UploadService(ref.read(apiProvider)).uploadPrivatePhoto(f);
      final m = await ref.read(apiProvider).sendChat(widget.id, clientId: clientId, mediaId: mediaId);
      if (mounted) setState(() => _messages = mergeMessages(_messages.where((x) => x.clientId != clientId).toList(), [m]));
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages = _messages.where((x) => x.clientId != clientId).toList());
      showError(context, e);
    }
  }

  Future<void> _menu(String action) async {
    final h = _header;
    if (h == null) return;
    final api = ref.read(apiProvider);
    try {
      switch (action) {
        case 'profile':
          if (h.counterpart.type == 'PARTNER' && h.counterpart.id != null) await context.push('/service-partner/${h.counterpart.id}');
          if (h.counterpart.type == 'SELLER' && h.counterpart.id != null) {
            await context.push('/shop?vendor=${h.counterpart.id}&name=${Uri.encodeComponent(h.counterpart.name)}');
          }
        case 'block':
          final ok = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: Text('Block ${h.counterpart.name}?'),
              content: const Text('Neither of you can send messages here, and you won’t see each other’s posts. You can unblock later.'),
              actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Block'))],
            ),
          );
          if (ok == true) {
            final nh = await api.blockChat(h.id, true);
            if (mounted) setState(() => _header = nh);
          }
        case 'unblock':
          final nh = await api.blockChat(h.id, false);
          if (mounted) setState(() => _header = nh);
        case 'close':
          await api.closeTicket(h.ticket!.id);
          await _load();
          if (mounted) showMessage(context, 'Ticket closed. Thanks for letting us know.');
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _messageActions(ChatMessage m) async {
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
      await reportContent(context, 'CHAT_MESSAGE', m.id, 'message');
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(chatEventsProvider, (_, e) {
      final ev = e.valueOrNull;
      if (ev != null) _onEvent(ev);
    });
    final h = _header;
    if (h == null) {
      return Scaffold(appBar: AppBar(), body: _error != null ? ErrorView(error: _error!, onRetry: _load) : const LoadingView());
    }
    final typing = _typingUntil != null && DateTime.now().isBefore(_typingUntil!);
    final subtitle = typing
        ? 'typing…'
        : h.isSupport
            ? '${h.ticket?.code ?? ''} · ${h.ticket?.subject ?? ''}'
            : h.counterpart.city ?? (h.counterpart.type == 'PARTNER' ? 'Pet care' : h.counterpart.type == 'SELLER' ? 'Seller' : '');
    final seen = seenText(_messages, h.otherReadAt);
    final shown = _messages.reversed.toList();

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(children: [
          h.isSupport ? const CircleAvatar(radius: 18, backgroundColor: Color(0xFFDCEBE8), child: Icon(Icons.support_agent, color: Brand.teal, size: 20)) : Avatar(url: h.counterpart.avatarUrl, name: h.counterpart.name),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(h.counterpart.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              if (subtitle.isNotEmpty) Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: typing ? Brand.teal : Brand.muted)),
            ]),
          ),
        ]),
        actions: [
          PopupMenuButton<String>(
            onSelected: _menu,
            itemBuilder: (_) => [
              if (!h.isSupport && (h.counterpart.type == 'PARTNER' || h.counterpart.type == 'SELLER')) const PopupMenuItem(value: 'profile', child: Text('View profile')),
              if (!h.isSupport) PopupMenuItem(value: h.blockedByMe ? 'unblock' : 'block', child: Text(h.blockedByMe ? 'Unblock' : 'Block')),
              if (h.isSupport && h.ticket != null && h.ticket!.status != 'CLOSED') const PopupMenuItem(value: 'close', child: Text('Close ticket')),
            ],
          ),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: _messages.isEmpty
              ? EmptyView(title: 'Say hello', message: h.isSupport ? null : 'Ask about times, prices or anything else. Be kind: messages can be reported.')
              : ListView.builder(
                  controller: _scroll,
                  reverse: true,
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  itemCount: shown.length + (seen != null ? 1 : 0),
                  itemBuilder: (context, i) {
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
                      MessageBubble(message: m, onLongPress: () => _messageActions(m), onRetry: m.failed ? () => _send(retry: m) : null),
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
                  label: Text('Share this ${switch (widget.offerRefType) { 'BOOKING' => 'booking', 'ORDER' => 'order', _ => 'product' }}'),
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
                if (h.blockedByMe) TextButton(onPressed: () => _menu('unblock'), child: const Text('Unblock')),
                if (h.isSupport) TextButton(onPressed: () => context.push('/help/new'), child: const Text('New ticket')),
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

/// A message: yours on the right, theirs on the left, PetApp's notices in the middle.
class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.message, this.onLongPress, this.onRetry});
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
    final bg = mine ? Brand.teal : m.side == 'STAFF' ? const Color(0xFFDCEBE8) : Colors.white;
    final fg = mine ? Colors.white : Brand.ink;
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
            color: bg,
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
                    onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => _PhotoView(url: m.media!.imageFor(1080) ?? img))),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: AspectRatio(aspectRatio: m.media!.aspectRatio.clamp(0.6, 1.8), child: CachedNetworkImage(imageUrl: img, fit: BoxFit.cover, cacheKey: 'chat-${m.media!.id}-480')),
                    ),
                  ),
                ),
              if (m.ref != null) _RefCard(r: m.ref!, onDark: mine),
              if (m.body != null && m.body!.isNotEmpty) SelectableText(m.body!, style: TextStyle(color: fg, fontSize: 15, height: 1.3)),
            ],
            const SizedBox(height: 2),
            Row(mainAxisSize: MainAxisSize.min, children: [
              Text(
                m.failed ? 'Not sent · tap to retry' : m.sending ? 'Sending…' : timeLabel(m.createdAt.toLocal()),
                style: TextStyle(fontSize: 10, color: m.failed ? const Color(0xFFFFD2C2) : mine ? Colors.white70 : Brand.muted),
              ),
            ]),
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
    final route = r.unavailable
        ? null
        : switch (r.type) {
            'BOOKING' => '/booking/${r.id}',
            'PRODUCT' => '/product/${r.slug ?? r.id}',
            _ => '/orders',
          };
    return InkWell(
      onTap: route == null ? null : () => context.push(route),
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(color: onDark ? const Color(0x1FFFFFFF) : const Color(0xFFF7F2EB), borderRadius: BorderRadius.circular(10)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (r.imageUrl != null)
            Padding(padding: const EdgeInsets.only(right: 8), child: ClipRRect(borderRadius: BorderRadius.circular(6), child: CachedNetworkImage(imageUrl: r.imageUrl!, width: 44, height: 44, fit: BoxFit.cover)))
          else
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Icon(switch (r.type) { 'BOOKING' => Icons.event_available_outlined, 'ORDER' => Icons.local_shipping_outlined, _ => Icons.shopping_bag_outlined }, color: onDark ? Colors.white : Brand.teal),
            ),
          Flexible(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(lines.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, color: onDark ? Colors.white : Brand.ink)),
              if (lines.subtitle.isNotEmpty) Text(lines.subtitle, style: TextStyle(fontSize: 12, color: onDark ? Colors.white70 : Brand.muted)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _PhotoView extends StatelessWidget {
  const _PhotoView({required this.url});
  final String url;
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white),
        body: Center(child: InteractiveViewer(child: CachedNetworkImage(imageUrl: url))),
      );
}
