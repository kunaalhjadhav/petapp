import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'legal_markdown.dart';

/// Shows the terms PetApp asked for (the current version) and records acceptance. True once accepted.
Future<bool> acceptTermsScreen(BuildContext context, WidgetRef ref, String slug) async {
  final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => TermsScreen(slug: slug)));
  return ok == true;
}

/// Runs an action; if PetApp says terms must be accepted first, shows them and tries once more.
/// Returns null when they weren't accepted.
Future<T?> withTerms<T>(BuildContext context, WidgetRef ref, Future<T> Function() action) async {
  try {
    return await action();
  } on ApiException catch (e) {
    if (!e.needsTerms || !context.mounted) rethrow;
    if (!await acceptTermsScreen(context, ref, e.termsSlug!)) return null;
    return action();
  }
}

final _docProvider = FutureProvider.autoDispose.family<LegalDoc, String>((ref, slug) => ref.watch(apiProvider).legalDoc(slug));

class TermsScreen extends ConsumerStatefulWidget {
  const TermsScreen({super.key, required this.slug});
  final String slug;
  @override
  ConsumerState<TermsScreen> createState() => _TermsScreenState();
}

class _TermsScreenState extends ConsumerState<TermsScreen> {
  bool _agree = false;
  bool _busy = false;

  Future<void> _accept(LegalDoc d) async {
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).acceptTerms(d.slug, d.version);
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
    final doc = ref.watch(_docProvider(widget.slug));
    return Scaffold(
      appBar: AppBar(title: Text(doc.valueOrNull?.title ?? 'Terms')),
      body: doc.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(ApiException.from(e).message, textAlign: TextAlign.center))),
        data: (d) => Column(children: [
          Expanded(
            child: ListView(padding: const EdgeInsets.fromLTRB(20, 16, 20, 24), children: [
              Text('Version ${d.version}', style: const TextStyle(color: Brand.muted, fontSize: 12)),
              const SizedBox(height: 12),
              LegalMarkdown(d.body),
            ]),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 16, 12),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _agree,
                  onChanged: _busy ? null : (v) => setState(() => _agree = v == true),
                  title: Text('I have read and agree to the ${d.title}'),
                ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(onPressed: _agree && !_busy ? () => _accept(d) : null, child: Text(_busy ? 'Saving…' : 'Agree and continue')),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
