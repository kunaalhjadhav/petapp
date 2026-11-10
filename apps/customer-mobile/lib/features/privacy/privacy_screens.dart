import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/api_client.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import 'legal_markdown.dart';

final consentsProvider = FutureProvider.autoDispose<ConsentStatus>((ref) => ref.watch(apiProvider).consents());
final legalDocsProvider = FutureProvider.autoDispose<List<LegalDocSummary>>((ref) => ref.watch(apiProvider).legalDocs());
final legalDocProvider = FutureProvider.autoDispose.family<LegalDoc, String>((ref, slug) => ref.watch(apiProvider).legalDoc(slug));
final dataExportsProvider = FutureProvider.autoDispose<DataExports>((ref) => ref.watch(apiProvider).dataExports());

/// "12 Oct 2026"
String dayText(DateTime? d) {
  if (d == null) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final l = d.toLocal();
  return '${l.day} ${m[l.month - 1]} ${l.year}';
}

/// "1.2 MB", "840 KB"
String sizeText(int? bytes) {
  if (bytes == null) return '';
  if (bytes >= 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  return '${(bytes / 1024).ceil()} KB';
}

/// What a data copy's status means to the person.
String exportStatusText(DataExportItem e) => switch (e.status) {
      'PENDING' => 'Being prepared. We’ll notify you when it’s ready.',
      'READY' => 'Ready${e.sizeBytes != null ? ' · ${sizeText(e.sizeBytes)}' : ''} · download until ${dayText(e.expiresAt)}',
      'FAILED' => 'Couldn’t be prepared. Please ask again.',
      _ => 'Expired',
    };

/// Your data and privacy: legal documents, marketing, a copy of your data, and deleting your account.
class PrivacyScreen extends ConsumerWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiProvider);
    final consents = ref.watch(consentsProvider);
    final exports = ref.watch(dataExportsProvider);
    final docs = ref.watch(legalDocsProvider);
    const heading = TextStyle(fontWeight: FontWeight.w700);

    return Scaffold(
      appBar: AppBar(title: const Text('Your data and privacy')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(consentsProvider);
          ref.invalidate(dataExportsProvider);
          ref.invalidate(legalDocsProvider);
        },
        child: ListView(children: [
          const ListTile(title: Text('Messages from PetApp', style: heading)),
          consents.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(consentsProvider)),
            data: (c) => SwitchListTile(
              title: const Text('Offers and news'),
              subtitle: const Text('Deals, new features and events, by notification, SMS or email. Orders, bookings and account messages are always sent.'),
              isThreeLine: true,
              value: c.marketing,
              onChanged: (v) async {
                try {
                  await api.setMarketing(v);
                  ref.invalidate(consentsProvider);
                  if (context.mounted) showMessage(context, v ? 'You’ll hear about offers and news' : 'No more offers or news');
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              },
            ),
          ),
          const Divider(),
          const ListTile(
            title: Text('A copy of your data', style: heading),
            subtitle: Text('Everything PetApp holds about you (profile, pets, posts, orders, bookings, payments, chats and more) in one file.'),
          ),
          exports.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(dataExportsProvider)),
            data: (x) => Column(children: [
              for (final e in x.items.where((e) => e.status != 'EXPIRED').take(3))
                ListTile(
                  leading: Icon(e.ready ? Icons.download_rounded : e.status == 'FAILED' ? Icons.error_outline : Icons.hourglass_top_rounded, color: e.status == 'FAILED' ? Brand.heart : Brand.teal),
                  title: Text('Asked on ${dayText(e.createdAt)}'),
                  subtitle: Text(exportStatusText(e)),
                  onTap: e.ready ? () => _download(context, ref, e) : null,
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: x.canRequest
                      ? OutlinedButton.icon(
                          icon: const Icon(Icons.archive_outlined),
                          label: const Text('Ask for a copy'),
                          onPressed: () async {
                            try {
                              await api.requestDataExport();
                              ref.invalidate(dataExportsProvider);
                              if (context.mounted) showMessage(context, 'We’re preparing your copy. We’ll notify you when it’s ready.');
                            } catch (e) {
                              if (context.mounted) showError(context, e);
                            }
                          },
                        )
                      : Text('You can ask for another copy after ${dayText(x.nextAllowedAt)}.', style: const TextStyle(color: Brand.muted, fontSize: 12)),
                ),
              ),
            ]),
          ),
          const Divider(),
          const ListTile(title: Text('Policies and terms', style: heading)),
          docs.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(legalDocsProvider)),
            data: (list) => list.isEmpty
                ? const ListTile(title: Text('Not published yet', style: TextStyle(color: Brand.muted)))
                : Column(children: [
                    for (final d in list)
                      ListTile(
                        title: Text(d.title),
                        subtitle: _accepted(consents.valueOrNull, d),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.push('/legal/${d.slug}'),
                      ),
                  ]),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.delete_forever_outlined, color: Brand.heart),
            title: const Text('Delete account', style: TextStyle(color: Brand.heart)),
            subtitle: const Text('Ask for a copy of your data first if you want one.'),
            onTap: () => confirmDeleteAccount(context, ref),
          ),
          const SizedBox(height: 24),
        ]),
      ),
    );
  }

  Widget? _accepted(ConsentStatus? c, LegalDocSummary d) {
    final mine = c?.documents.where((x) => x.slug == d.slug).firstOrNull;
    if (mine == null) return Text('Updated ${dayText(d.effectiveAt)}');
    if (mine.pending) return const Text('Please read and accept', style: TextStyle(color: Brand.heart));
    return Text('You accepted version ${mine.acceptedVersion} on ${dayText(mine.acceptedAt)}');
  }

  Future<void> _download(BuildContext context, WidgetRef ref, DataExportItem e) async {
    try {
      final link = await ref.read(apiProvider).dataExportLink(e.id);
      final ok = await launchUrl(Uri.parse(link.url), mode: LaunchMode.externalApplication);
      if (!ok && context.mounted) showMessage(context, 'Couldn’t open the download. Try again.');
    } catch (err) {
      if (context.mounted) showError(context, err);
    }
  }
}

/// Explains the grace period, then asks to delete. Shared by Settings and Your data.
Future<void> confirmDeleteAccount(BuildContext context, WidgetRef ref) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Delete your account?'),
      content: const Text(
        'You’ll be signed out on every device. After a grace period your profile, pets, posts, photos and chats are erased for good.\n\n'
        'Changed your mind? Sign in again before then and your account stays.\n\n'
        'Orders, payments and invoices are kept without your profile, as tax law requires.',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete', style: TextStyle(color: Brand.heart))),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await ref.read(authProvider.notifier).deleteAccount();
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

/// A legal document. Readable before signing in (linked from the sign-in screen).
class LegalDocScreen extends ConsumerWidget {
  const LegalDocScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final doc = ref.watch(legalDocProvider(slug));
    return Scaffold(
      appBar: AppBar(title: Text(doc.valueOrNull?.title ?? '')),
      body: doc.when(
        loading: () => const LoadingView(),
        error: (e, _) => ApiException.from(e).isNotFound
            ? const EmptyView(title: 'Not available yet', message: 'This document hasn’t been published yet.')
            : ErrorView(error: e, onRetry: () => ref.invalidate(legalDocProvider(slug))),
        data: (d) => ListView(padding: const EdgeInsets.fromLTRB(20, 16, 20, 32), children: [
          Text('Version ${d.version} · in effect from ${dayText(d.effectiveAt)}', style: const TextStyle(color: Brand.muted, fontSize: 12)),
          const SizedBox(height: 12),
          LegalMarkdown(d.body),
        ]),
      ),
    );
  }
}

/// Asks the person to accept documents (the current versions). Returns true once all are accepted.
/// Used on app start for updated terms, and when an action needs a document first (e.g. entering a contest).
Future<bool> acceptTerms(BuildContext context, WidgetRef ref, List<String> slugs, {bool dismissible = true}) async {
  final api = ref.read(apiProvider);
  final ConsentStatus status;
  try {
    status = await api.consents();
  } catch (e) {
    if (context.mounted) showError(context, e);
    return false;
  }
  final docs = status.documents.where((d) => slugs.contains(d.slug) && d.acceptedVersion != d.version).toList();
  if (docs.isEmpty) return true;
  if (!context.mounted) return false;
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    isDismissible: dismissible,
    enableDrag: dismissible,
    builder: (ctx) => PopScope(canPop: dismissible, child: _TermsSheet(docs: docs, dismissible: dismissible)),
  );
  if (ok == true) ref.invalidate(consentsProvider);
  return ok == true;
}

class _TermsSheet extends ConsumerStatefulWidget {
  const _TermsSheet({required this.docs, required this.dismissible});
  final List<ConsentDoc> docs;
  final bool dismissible;
  @override
  ConsumerState<_TermsSheet> createState() => _TermsSheetState();
}

class _TermsSheetState extends ConsumerState<_TermsSheet> {
  bool _agree = false;
  bool _busy = false;

  Future<void> _accept() async {
    setState(() => _busy = true);
    try {
      for (final d in widget.docs) {
        await ref.read(apiProvider).accept(d.slug, d.version);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        showError(context, e);
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final updated = widget.docs.any((d) => d.updated);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(updated ? 'We’ve updated our terms' : 'Before you continue', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          const Text('Please read and accept:', style: TextStyle(color: Brand.muted)),
          const SizedBox(height: 8),
          for (final d in widget.docs)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.description_outlined, color: Brand.teal),
              title: Text(d.title),
              subtitle: d.updated && (d.changeSummary ?? '').isNotEmpty ? Text('What changed: ${d.changeSummary}') : null,
              trailing: TextButton(onPressed: () => context.push('/legal/${d.slug}'), child: const Text('Read')),
            ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _agree,
            onChanged: _busy ? null : (v) => setState(() => _agree = v == true),
            title: Text(widget.docs.length == 1 ? 'I have read and agree to the ${widget.docs.first.title}' : 'I have read and agree to these'),
          ),
          const SizedBox(height: 8),
          Row(children: [
            if (widget.dismissible) TextButton(onPressed: _busy ? null : () => Navigator.pop(context, false), child: const Text('Not now')),
            const Spacer(),
            FilledButton(onPressed: _agree && !_busy ? _accept : null, child: Text(_busy ? 'Saving…' : 'Agree and continue')),
          ]),
        ]),
      ),
    );
  }
}

/// Runs an action; if the API says a document must be accepted first, asks for it and tries once more.
/// Returns null when the person chose not to accept.
Future<T?> withTerms<T>(BuildContext context, WidgetRef ref, Future<T> Function() action) async {
  try {
    return await action();
  } on ApiException catch (e) {
    if (!e.needsTerms || !context.mounted) rethrow;
    final ok = await acceptTerms(context, ref, [e.termsSlug!]);
    if (!ok) return null;
    return action();
  }
}

/// On app start: asks for terms everyone must accept that changed since (or were never) accepted.
/// It can't be dismissed: the app needs current terms to keep going.
Future<void> checkPendingTerms(BuildContext context, WidgetRef ref) async {
  try {
    final s = await ref.read(apiProvider).consents();
    if (s.pending.isEmpty || !context.mounted) return;
    await acceptTerms(context, ref, s.pending, dismissible: false);
  } catch (_) {
    // Offline or a hiccup: ask next time.
  }
}
