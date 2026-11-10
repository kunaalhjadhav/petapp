import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/upload_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../chat/chat_screens.dart';
import '../privacy/legal_markdown.dart';

final _helpProvider = FutureProvider.autoDispose.family<HelpCenter, String>((ref, q) => ref.watch(apiProvider).helpCenter(q: q.isEmpty ? null : q));
final myTicketsProvider = FutureProvider.autoDispose<List<SupportTicket>>((ref) => ref.watch(apiProvider).myTickets());
final _topicsProvider = FutureProvider.autoDispose<List<SupportTopic>>((ref) => ref.watch(apiProvider).supportTopics());
final _ticketProvider = FutureProvider.autoDispose.family<SupportTicket, String>((ref, id) => ref.watch(apiProvider).ticket(id));

/// Help & support: answers first, then a way to write to PetApp.
class HelpScreen extends ConsumerStatefulWidget {
  const HelpScreen({super.key});
  @override
  ConsumerState<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends ConsumerState<HelpScreen> {
  String _q = '';
  String? _topic;
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
    final tickets = ref.watch(myTicketsProvider).valueOrNull ?? const <SupportTicket>[];
    final open = tickets.where((t) => t.open).length;
    final unread = tickets.fold<int>(0, (a, t) => a + t.unread);

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
            trailing: unread > 0 ? Chip(label: Text('$unread new'), visualDensity: VisualDensity.compact) : const Icon(Icons.chevron_right),
            onTap: () => context.push('/help/tickets'),
          ),
        help.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_helpProvider(_q))),
          data: (h) {
            final faqs = _topic == null ? h.faqs : h.faqs.where((f) => f.categoryId == _topic).toList();
            final usedTopics = h.topics.where((t) => h.faqs.any((f) => f.categoryId == t.id)).toList();
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (usedTopics.length > 1)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(children: [
                    for (final t in [null, ...usedTopics])
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: ChoiceChip(label: Text(t?.name ?? 'All'), selected: _topic == t?.id, onSelected: (_) => setState(() => _topic = t?.id)),
                      ),
                  ]),
                ),
              if (faqs.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(_q.isEmpty ? 'No answers here yet. Write to us below.' : 'Nothing matches “$_q”. Write to us below and we’ll help.', style: const TextStyle(color: Brand.muted)),
                ),
              for (final f in faqs)
                ExpansionTile(
                  title: Text(f.question, style: const TextStyle(fontWeight: FontWeight.w600)),
                  childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  expandedCrossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    LegalMarkdown(f.answer),
                    const SizedBox(height: 8),
                    _voted.contains(f.id)
                        ? const Text('Thanks for letting us know.', style: TextStyle(color: Brand.muted, fontSize: 12))
                        : Row(children: [
                            const Text('Did this help?', style: TextStyle(color: Brand.muted, fontSize: 12)),
                            TextButton(onPressed: () => _vote(f.id, true), child: const Text('Yes')),
                            TextButton(onPressed: () => _vote(f.id, false), child: const Text('No')),
                          ]),
                  ],
                ),
            ]);
          },
        ),
        const Divider(height: 32),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: Text('Still need help?', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 4, 16, 12),
          child: Text('Write to the PetApp team. We reply here and send you a notification.', style: TextStyle(color: Brand.muted)),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: FilledButton.icon(icon: const Icon(Icons.mail_outline), label: const Text('Contact support'), onPressed: () => context.push('/help/new')),
        ),
      ]),
    );
  }

  Future<void> _vote(String id, bool helpful) async {
    setState(() => _voted.add(id));
    try {
      await ref.read(apiProvider).faqFeedback(id, helpful);
    } catch (_) {
      // Feedback is a nicety; never bother the person with a failure.
    }
  }
}

/// Write to support. Can be about a booking or an order (opened from that page).
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
  bool _withRef = true;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2400, imageQuality: 85);
    if (f != null && mounted) setState(() => _photos.add(f));
  }

  Future<void> _submit() async {
    if (_topic == null || _subject.text.trim().length < 3 || _body.text.trim().isEmpty) {
      showMessage(context, 'Choose a topic, and write a subject and a message.');
      return;
    }
    setState(() => _busy = true);
    try {
      final uploads = UploadService(ref.read(apiProvider));
      final ids = <String>[for (final p in _photos) await uploads.uploadPrivatePhoto(p)];
      final t = await ref.read(apiProvider).openTicket(
            categoryId: _topic!,
            subject: _subject.text.trim(),
            body: _body.text.trim(),
            mediaIds: ids,
            refType: _withRef ? widget.refType : null,
            refId: _withRef ? widget.refId : null,
          );
      ref.invalidate(myTicketsProvider);
      if (!mounted) return;
      showMessage(context, 'Sent. Your ticket is ${t.code}; we’ll reply here.');
      unawaited(context.pushReplacement('/messages/${t.conversationId}'));
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
        if (widget.refType != null && widget.refId != null)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _withRef,
            onChanged: (v) => setState(() => _withRef = v ?? false),
            title: Text('About ${widget.refLabel ?? (widget.refType == 'BOOKING' ? 'this booking' : 'this order')}'),
          ),
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
            Stack(children: [
              ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.file(File(p.path), width: 72, height: 72, fit: BoxFit.cover)),
              Positioned(
                right: 0,
                top: 0,
                child: InkWell(onTap: () => setState(() => _photos.remove(p)), child: const CircleAvatar(radius: 11, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 14, color: Colors.white))),
              ),
            ]),
          if (_photos.length < 5) OutlinedButton.icon(onPressed: _addPhoto, icon: const Icon(Icons.add_photo_alternate_outlined), label: const Text('Add a photo')),
        ]),
        const SizedBox(height: 8),
        const Text('Photos are only seen by the PetApp team.', style: TextStyle(color: Brand.muted, fontSize: 12)),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _submit, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Send')),
      ]),
    );
  }
}

/// Tickets the person has written, newest activity first.
class TicketsScreen extends ConsumerWidget {
  const TicketsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(myTicketsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Your tickets')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => context.push('/help/new'), icon: const Icon(Icons.add), label: const Text('New ticket')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myTicketsProvider),
        child: tickets.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(myTicketsProvider)),
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
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(ago(t.lastMessageAt), style: const TextStyle(color: Brand.muted, fontSize: 12)),
                        if (t.unread > 0) ...[const SizedBox(height: 4), CircleAvatar(radius: 9, backgroundColor: Brand.teal, child: Text('${t.unread}', style: const TextStyle(fontSize: 10, color: Colors.white)))],
                      ]),
                      onTap: () async {
                        await context.push('/messages/${t.conversationId}');
                        ref.invalidate(myTicketsProvider);
                      },
                    );
                  },
                ),
        ),
      ),
    );
  }
}

/// Opened from a support notification (it carries the ticket): shows the ticket's conversation.
class TicketScreen extends ConsumerWidget {
  const TicketScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(_ticketProvider(id)).when(
        loading: () => const Scaffold(body: LoadingView()),
        error: (e, _) => Scaffold(appBar: AppBar(), body: ErrorView(error: e, onRetry: () => ref.invalidate(_ticketProvider(id)))),
        data: (t) => ConversationScreen(id: t.conversationId),
      );
}
