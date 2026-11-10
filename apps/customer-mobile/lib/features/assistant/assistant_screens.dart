import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/models.dart';
import '../../common/money_text.dart' show dateTime, shortDate;
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../contests/contest_screens.dart' show rupees;
import '../home/place.dart';

final _infoProvider = FutureProvider.autoDispose<AssistantInfo>((ref) => ref.watch(apiProvider).assistantInfo());

/// The app's tabs: opened with go() so they switch tabs instead of stacking a copy.
const _tabs = {'/home', '/reels', '/create', '/alerts', '/me'};

void openRoute(BuildContext context, String route) {
  if (_tabs.contains(route)) {
    context.go(route);
  } else {
    context.push(route);
  }
}

/// Chat with PetApp Assistant. With [conversationId], continues an earlier conversation.
class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({super.key, this.conversationId});
  final String? conversationId;
  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  final List<AssistantMessageView> _messages = [];
  String? _conversationId;
  String? _pending; // the question being answered
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _conversationId = widget.conversationId;
    if (_conversationId != null) _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final c = await ref.read(apiProvider).assistantConversation(_conversationId!);
      if (mounted) setState(() => _messages..clear()..addAll(c.messages));
      _toEnd();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _toEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      });

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _text.text).trim();
    if (text.isEmpty || _pending != null) return;
    _text.clear();
    setState(() => _pending = text);
    _toEnd();
    final place = ref.read(searchPlaceProvider);
    try {
      final r = await ref.read(apiProvider).askAssistant(text, conversationId: _conversationId, lat: place?.at.lat, lng: place?.at.lng);
      if (!mounted) return;
      setState(() {
        _conversationId = r.conversationId;
        _messages.addAll([r.question, r.answer]);
        _pending = null;
      });
      ref.invalidate(_infoProvider);
      _toEnd();
    } catch (e) {
      if (!mounted) return;
      setState(() => _pending = null);
      _text.text = text; // keep what they typed
      showError(context, e);
    }
  }

  void _newChat() => setState(() {
        _messages.clear();
        _conversationId = null;
      });

  Future<void> _rate(AssistantMessageView m, String rating) async {
    String? note;
    if (rating == 'DOWN') {
      final c = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('What was wrong?'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            TextField(controller: c, maxLength: 500, maxLines: 3, decoration: const InputDecoration(hintText: 'Optional')),
            const Text('This answer and your question will be shared with the PetApp team to improve the assistant.', style: TextStyle(fontSize: 12, color: Brand.muted)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send')),
          ],
        ),
      );
      if (ok != true) return;
      note = c.text.trim();
    }
    try {
      final r = await ref.read(apiProvider).rateAnswer(m.id, rating, note: note);
      if (!mounted) return;
      setState(() {
        final i = _messages.indexWhere((x) => x.id == m.id);
        if (i >= 0) _messages[i] = m.rated(r.rating ?? rating);
      });
      if (rating == 'DOWN') showMessage(context, 'Thanks. We’ll look at this answer.');
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  void dispose() {
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final info = ref.watch(_infoProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('PetApp Assistant'),
        actions: [
          IconButton(tooltip: 'Earlier chats', icon: const Icon(Icons.history), onPressed: () => context.push('/assistant/history')),
          if (_messages.isNotEmpty) IconButton(tooltip: 'New chat', icon: const Icon(Icons.add_comment_outlined), onPressed: _newChat),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: _loading
              ? const LoadingView()
              : ListView(controller: _scroll, padding: const EdgeInsets.fromLTRB(12, 12, 12, 8), children: [
                  if (_messages.isEmpty)
                    info.when(
                      loading: () => const LoadingView(),
                      error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_infoProvider)),
                      data: (i) => _Intro(info: i, onAsk: _send),
                    ),
                  for (final m in _messages) m.fromMe ? _Bubble(text: m.text, mine: true) : _Answer(message: m, onRate: (r) => _rate(m, r)),
                  if (_pending != null) ...[
                    _Bubble(text: _pending!, mine: true),
                    const Padding(padding: EdgeInsets.all(12), child: Align(alignment: Alignment.centerLeft, child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))),
                  ],
                ]),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 8, 8),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _text,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 1000,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _send(),
                  decoration: const InputDecoration(hintText: 'Ask about services, products, contests…', counterText: ''),
                ),
              ),
              IconButton.filled(tooltip: 'Send', onPressed: _pending == null ? () => _send() : null, icon: const Icon(Icons.send_rounded)),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _Intro extends StatelessWidget {
  const _Intro({required this.info, required this.onAsk});
  final AssistantInfo info;
  final void Function(String) onAsk;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SizedBox(height: 8),
        const Icon(Icons.auto_awesome, color: Brand.teal, size: 32),
        const SizedBox(height: 8),
        Text(info.intro, style: const TextStyle(fontSize: 16)),
        const SizedBox(height: 12),
        _Notice(text: info.healthNotice, urgent: false),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [for (final s in info.suggestions) ActionChip(label: Text(s), onPressed: () => onAsk(s))]),
        const SizedBox(height: 16),
        Text('${info.privacy} ${info.left} of ${info.dailyLimit} questions left today.', style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ]);
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.text, required this.mine});
  final String text;
  final bool mine;
  @override
  Widget build(BuildContext context) => Align(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
          decoration: BoxDecoration(color: mine ? Brand.teal : Colors.white, borderRadius: BorderRadius.circular(16), border: mine ? null : Border.all(color: Brand.line)),
          child: SelectableText(text, style: TextStyle(color: mine ? Colors.white : Brand.ink)),
        ),
      );
}

/// "General information, not a diagnosis" (amber) or "This could be an emergency" (red).
class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.urgent});
  final String text;
  final bool urgent;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: urgent ? const Color(0xFFFBE4DE) : const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(10)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(urgent ? Icons.emergency_outlined : Icons.medical_information_outlined, size: 20, color: urgent ? Brand.heart : const Color(0xFF8A6100)),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(fontSize: 13, fontWeight: urgent ? FontWeight.w700 : FontWeight.w500, color: urgent ? Brand.heart : const Color(0xFF6B4C00)))),
        ]),
      );
}

class _Answer extends StatelessWidget {
  const _Answer({required this.message, required this.onRate});
  final AssistantMessageView message;
  final void Function(String) onRate;
  @override
  Widget build(BuildContext context) {
    final m = message;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (m.notice != null) Padding(padding: const EdgeInsets.only(bottom: 6), child: _Notice(text: m.notice!, urgent: m.urgent)),
        _Bubble(text: m.text, mine: false),
        for (final c in m.cards) Padding(padding: const EdgeInsets.only(top: 6), child: _CardTile(card: c)),
        Row(children: [
          IconButton(
            tooltip: 'Helpful',
            visualDensity: VisualDensity.compact,
            icon: Icon(m.rating == 'UP' ? Icons.thumb_up : Icons.thumb_up_outlined, size: 18, color: Brand.muted),
            onPressed: m.rating == null ? () => onRate('UP') : null,
          ),
          IconButton(
            tooltip: 'Not helpful',
            visualDensity: VisualDensity.compact,
            icon: Icon(m.rating == 'DOWN' ? Icons.thumb_down : Icons.thumb_down_outlined, size: 18, color: Brand.muted),
            onPressed: m.rating == null ? () => onRate('DOWN') : null,
          ),
        ]),
      ]),
    );
  }
}

/// A result under an answer. Tapping opens it in the app.
class _CardTile extends StatelessWidget {
  const _CardTile({required this.card});
  final AssistantCard card;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, String title, String? subtitle, String? route) = switch (card.item) {
      NearbyPartner p => (
          Icons.storefront_outlined,
          p.businessName,
          [if (p.distanceKm > 0) '${p.distanceKm.toStringAsFixed(1)} km', if (p.ratingCount > 0) '★ ${p.ratingAvg.toStringAsFixed(1)} (${p.ratingCount})', 'from ${rupees(p.fromPaise)}'].join(' · '),
          '/service-partner/${p.id}',
        ),
      ProductCard p => (Icons.shopping_bag_outlined, p.title, '${rupees(p.fromPaise)} · ${p.vendorName}${p.inStock ? '' : ' · out of stock'}', '/product/${p.id}'),
      ContestCard c => (
          Icons.emoji_events_outlined,
          c.title,
          [c.isFree ? 'Free' : rupees(c.feePaise), if (c.registrationClosesAt != null && c.registrationOpen) 'entries close ${shortDate(c.registrationClosesAt!)}'].join(' · '),
          '/contest/${c.id}',
        ),
      ChallengeCard c => (Icons.local_fire_department_outlined, c.title, c.mine != null ? 'You’ve joined' : '${c.participants} taking part', '/challenge/${c.id}'),
      AssistantBooking b => (Icons.event_available_outlined, b.title, [b.petName, if (b.startsAt != null) dateTime(b.startsAt!)].join(' · '), '/booking/${b.id}'),
      AssistantLink l => (Icons.touch_app_outlined, l.title, l.steps.join(' '), l.route),
      CareNote n => (Icons.pets, n.title, null, null),
      _ => (Icons.info_outline, '', null, null),
    };
    if (card.item is CareNote) {
      final n = card.item as CareNote;
      return Card(
        margin: EdgeInsets.zero,
        child: ExpansionTile(
          leading: Icon(icon, color: Brand.teal),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          children: [Text(n.body), const SizedBox(height: 8), const Text('General information, not a diagnosis.', style: TextStyle(fontSize: 12, color: Brand.muted))],
        ),
      );
    }
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        leading: Icon(icon, color: Brand.teal),
        title: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: subtitle == null || subtitle.isEmpty ? null : Text(subtitle, maxLines: 3, overflow: TextOverflow.ellipsis),
        trailing: route == null ? null : const Icon(Icons.chevron_right),
        onTap: route == null ? null : () => openRoute(context, route),
      ),
    );
  }
}

/// Earlier conversations: open one, delete one, or delete them all.
class AssistantHistoryScreen extends ConsumerStatefulWidget {
  const AssistantHistoryScreen({super.key});
  @override
  ConsumerState<AssistantHistoryScreen> createState() => _AssistantHistoryScreenState();
}

class _AssistantHistoryScreenState extends ConsumerState<AssistantHistoryScreen> {
  late Future<(List<AssistantConversation>, bool)> _list = ref.read(apiProvider).assistantConversations();

  void _reload() => setState(() => _list = ref.read(apiProvider).assistantConversations());

  Future<void> _deleteAll() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete all chats?'),
        content: const Text('Your conversations with PetApp Assistant are deleted for good.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete all')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(apiProvider).deleteAllConversations();
      _reload();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Earlier chats'), actions: [IconButton(tooltip: 'Delete all', icon: const Icon(Icons.delete_sweep_outlined), onPressed: _deleteAll)]),
        body: FutureBuilder<(List<AssistantConversation>, bool)>(
          future: _list,
          builder: (ctx, snap) {
            if (snap.connectionState != ConnectionState.done) return const LoadingView();
            if (snap.hasError) return ErrorView(error: snap.error!, onRetry: _reload);
            final items = snap.data!.$1;
            if (items.isEmpty) return const EmptyView(title: 'No chats yet', message: 'Your conversations with PetApp Assistant appear here.');
            return ListView(children: [
              for (final c in items)
                ListTile(
                  leading: const Icon(Icons.chat_bubble_outline),
                  title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: c.lastMessageAt == null ? null : Text(dateTime(c.lastMessageAt!)),
                  onTap: () => context.push('/assistant/${c.id}'),
                  trailing: IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      try {
                        await ref.read(apiProvider).deleteConversation(c.id);
                        _reload();
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                    },
                  ),
                ),
            ]);
          },
        ),
      );
}
