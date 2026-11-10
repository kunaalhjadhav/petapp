import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../common/widgets.dart';
import '../../services/upload_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../reviews/reviews_logic.dart';

/// Report anything (spec §59): a person, pet, post, reel, comment, product, business, review, contest entry or
/// chat message. Returns true once the report is sent.
///
/// [what] reads naturally after "this": "post", "review", "business".
Future<bool> reportContent(BuildContext context, String targetType, String targetId, String what) async {
  final sent = await Navigator.of(context).push<bool>(
    MaterialPageRoute<bool>(fullscreenDialog: true, builder: (_) => ReportScreen(targetType: targetType, targetId: targetId, what: what)),
  );
  if (sent == true && context.mounted) showMessage(context, 'Thanks. Our team will review it.');
  return sent == true;
}

class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key, required this.targetType, required this.targetId, required this.what});
  final String targetType;
  final String targetId;
  final String what;
  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {
  final _details = TextEditingController();
  final _shots = <XFile>[];
  String? _reason;
  bool _busy = false;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _addShot() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2400, imageQuality: 85);
    if (f != null && mounted) setState(() => _shots.add(f));
  }

  Future<void> _send() async {
    if (_reason == null) {
      showMessage(context, 'Choose a reason.');
      return;
    }
    setState(() => _busy = true);
    try {
      // Screenshots are private: only PetApp's moderators can open them.
      final uploads = UploadService(ref.read(apiProvider));
      final ids = <String>[for (final f in _shots) await uploads.uploadPrivatePhoto(f)];
      await ref.read(apiProvider).report(widget.targetType, widget.targetId, _reason!, details: _details.text.trim(), evidenceIds: ids);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Report this ${widget.what}')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
        const Text('Reports are private: the person won’t know who reported them. PetApp’s team reviews every report.', style: TextStyle(color: Brand.muted)),
        const SizedBox(height: 12),
        Text('Why are you reporting it?', style: Theme.of(context).textTheme.titleMedium),
        // A plain list of choices (works on every Flutter version the apps build with).
        for (final e in reportReasons.entries)
          Semantics(
            selected: _reason == e.key,
            inMutuallyExclusiveGroup: true,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(_reason == e.key ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: _reason == e.key ? Brand.teal : Brand.muted),
              title: Text(e.value),
              onTap: _busy ? null : () => setState(() => _reason = e.key),
            ),
          ),
        const SizedBox(height: 8),
        TextField(
          controller: _details,
          maxLength: 1000,
          minLines: 2,
          maxLines: 5,
          decoration: const InputDecoration(labelText: 'Anything else we should know? (optional)', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 8),
        Text('Screenshots (optional)', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 4),
        const Text('Only PetApp’s moderators can see them.', style: TextStyle(color: Brand.muted, fontSize: 13)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final (i, f) in _shots.indexed)
            InputChip(
              avatar: const Icon(Icons.image_outlined, size: 18),
              label: Text('Screenshot ${i + 1}'),
              onDeleted: _busy ? null : () => setState(() => _shots.remove(f)),
            ),
          if (_shots.length < reportEvidenceMax)
            ActionChip(avatar: const Icon(Icons.add_photo_alternate_outlined, size: 18), label: const Text('Add a screenshot'), onPressed: _busy ? null : _addShot),
        ]),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: _busy ? null : _send,
          child: _busy ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Send report'),
        ),
        if (widget.targetType != 'USER') ...[
          const SizedBox(height: 12),
          const Text('If someone is in danger, contact local emergency services first.', style: TextStyle(color: Brand.muted, fontSize: 13)),
        ],
      ]),
    );
  }
}
