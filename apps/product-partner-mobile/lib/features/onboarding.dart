import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../services/uploads.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'terms.dart';

const docKinds = {
  'ID_PROOF': 'ID proof (Aadhaar, PAN, passport or voter ID)',
  'GST_CERTIFICATE': 'GST certificate',
  'BUSINESS_REGISTRATION': 'Business registration',
  'ADDRESS_PROOF': 'Address proof',
  'PROFESSIONAL_LICENSE': 'Trade or FSSAI licence',
  'OTHER': 'Other',
};

/// Where a new or not-yet-approved seller lands: a checklist to get the store approved.
class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key, required this.profile});
  final VendorProfile? profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = profile;
    final banner = switch (p?.status) {
      'SUBMITTED' => ('Under review', 'Our team is checking your store details and documents. You’ll get a notification when it’s done.', Brand.teal),
      'REJECTED' => ('Changes needed', p?.statusReason ?? 'Please update your details and submit again.', Brand.heart),
      'SUSPENDED' => ('Store paused', p?.statusReason ?? 'Contact seller support.', Brand.heart),
      _ => null,
    };
    Widget step(String title, String subtitle, bool done, Widget Function()? page) => ListTile(
          leading: Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, color: done ? Brand.teal : Brand.muted),
          title: Text(title),
          subtitle: Text(subtitle),
          trailing: page == null ? null : const Icon(Icons.chevron_right),
          onTap: page == null ? null : () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page())),
        );
    final needsGst = p?.gstin != null;
    bool has(String kind) => p?.documents.any((d) => d.kind == kind && d.status != 'REJECTED') ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('Set up your store'), actions: [IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: () => ref.read(authProvider.notifier).logout())]),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(profileProvider),
        child: ListView(children: [
          if (banner != null)
            Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: banner.$3.withAlpha(20), borderRadius: BorderRadius.circular(12)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(banner.$1, style: TextStyle(fontWeight: FontWeight.w700, color: banner.$3)),
                const SizedBox(height: 4),
                Text(banner.$2),
              ]),
            )
          else
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Complete these steps. Once our team approves your store, you can list products and start selling.', style: TextStyle(color: Brand.muted)),
            ),
          step('Store details', p == null ? 'Name, pickup address and GSTIN' : p.businessName, p != null, () => StoreFormScreen(profile: p)),
          if (p != null) ...[
            step('ID proof', has('ID_PROOF') ? 'Uploaded' : 'Aadhaar, PAN, passport or voter ID', has('ID_PROOF'), () => const DocumentsScreen()),
            if (needsGst) step('GST certificate', has('GST_CERTIFICATE') ? 'Uploaded' : 'Needed because you gave a GSTIN', has('GST_CERTIFICATE'), () => const DocumentsScreen()),
            if (p.checklist.isNotEmpty && p.editable)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Text('Still needed: ${p.checklist.join(' ')}', style: const TextStyle(color: Brand.muted)),
              ),
            if (p.status == 'DRAFT' || p.status == 'REJECTED')
              Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton(
                  onPressed: !p.canSubmit
                      ? null
                      : () async {
                          try {
                            // PetApp's terms for partners and sellers are accepted (once per version) before submitting.
                            final done = await withTerms(context, ref, () => ref.read(apiProvider).submit());
                            if (done == null) {
                              if (context.mounted) showMessage(context, 'Not submitted. Accept the terms to submit.');
                              return;
                            }
                            ref.invalidate(profileProvider);
                            if (context.mounted) showMessage(context, 'Submitted. We’ll let you know once your store is approved.');
                          } catch (e) {
                            if (context.mounted) showError(context, e);
                          }
                        },
                  child: Text(p.status == 'REJECTED' ? 'Submit again' : 'Submit for approval'),
                ),
              ),
          ],
        ]),
      ),
    );
  }
}

class StoreFormScreen extends ConsumerStatefulWidget {
  const StoreFormScreen({super.key, this.profile});
  final VendorProfile? profile;
  @override
  ConsumerState<StoreFormScreen> createState() => _StoreFormState();
}

class _StoreFormState extends ConsumerState<StoreFormScreen> {
  late final p = widget.profile;
  late final _c = {
    'businessName': TextEditingController(text: p?.businessName),
    'legalName': TextEditingController(text: p?.legalName),
    'gstin': TextEditingController(text: p?.gstin),
    'phone': TextEditingController(text: p?.phone.replaceFirst('+91', '')),
    'email': TextEditingController(text: p?.email),
    'addressLine': TextEditingController(text: p?.addressLine),
    'city': TextEditingController(text: p?.city),
    'state': TextEditingController(text: p?.state),
    'pincode': TextEditingController(text: p?.pincode),
  };
  bool _busy = false;

  Future<void> _save() async {
    String? v(String k) => _c[k]!.text.trim().isEmpty ? null : _c[k]!.text.trim();
    final body = <String, Object?>{
      'businessName': v('businessName'), 'legalName': v('legalName'), 'gstin': v('gstin')?.toUpperCase(), 'phone': v('phone'), 'email': v('email'),
      'addressLine': v('addressLine'), 'city': v('city'), 'state': v('state'), 'pincode': v('pincode'),
    }..removeWhere((_, x) => x == null);
    setState(() => _busy = true);
    try {
      final api = ref.read(apiProvider);
      p == null ? await api.createProfile(body) : await api.updateProfile(body);
      ref.invalidate(profileProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Widget f(String k, String label, {TextInputType? type, String? hint}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextField(controller: _c[k], keyboardType: type, decoration: InputDecoration(labelText: label, helperText: hint, helperMaxLines: 2)),
        );
    final locked = p != null && !p!.editable;
    return Scaffold(
      appBar: AppBar(title: const Text('Store details')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (locked) const Padding(padding: EdgeInsets.only(bottom: 12), child: Text('Your store is under review and can’t be changed right now.', style: TextStyle(color: Brand.muted))),
        f('businessName', 'Store name', hint: 'What shoppers see'),
        f('legalName', 'Registered business name (optional)'),
        f('gstin', 'GSTIN (optional)', hint: '15 characters, e.g. 27ABCDE1234F1Z5. If you give one, upload your GST certificate too.'),
        f('phone', 'Store phone', type: TextInputType.phone),
        f('email', 'Email for orders (optional)', type: TextInputType.emailAddress),
        f('addressLine', 'Pickup address', hint: 'Where couriers collect your parcels'),
        f('city', 'City'),
        f('state', 'State'),
        f('pincode', 'PIN code', type: TextInputType.number),
        const SizedBox(height: 8),
        FilledButton(onPressed: _busy || locked ? null : _save, child: Text(_busy ? 'Saving…' : 'Save')),
      ]),
    );
  }
}

class DocumentsScreen extends ConsumerWidget {
  const DocumentsScreen({super.key});

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final kind = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(child: ListView(shrinkWrap: true, children: [for (final e in docKinds.entries) ListTile(title: Text(e.value), onTap: () => Navigator.pop(ctx, e.key))])),
    );
    if (kind == null || !context.mounted) return;
    final source = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'), onTap: () => Navigator.pop(ctx, 'camera')),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose a photo'), onTap: () => Navigator.pop(ctx, 'gallery')),
          ListTile(leading: const Icon(Icons.picture_as_pdf_outlined), title: const Text('Choose a PDF'), onTap: () => Navigator.pop(ctx, 'pdf')),
        ]),
      ),
    );
    if (source == null) return;
    String? path;
    if (source == 'pdf') {
      final r = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['pdf']);
      path = r?.files.single.path;
    } else {
      final x = await ImagePicker().pickImage(source: source == 'camera' ? ImageSource.camera : ImageSource.gallery, imageQuality: 90, maxWidth: 2400);
      path = x?.path;
    }
    if (path == null || !context.mounted) return;
    showMessage(context, 'Uploading…');
    try {
      await uploadDocument(ref.read(apiProvider), kind: kind, path: path);
      ref.invalidate(profileProvider);
      if (context.mounted) showMessage(context, 'Uploaded. Our team will check it.');
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(profileProvider).valueOrNull;
    final docs = p?.documents ?? const <VendorDocument>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Documents')),
      floatingActionButton: p != null && p.editable ? FloatingActionButton.extended(onPressed: () => _add(context, ref), icon: const Icon(Icons.upload_file), label: const Text('Upload')) : null,
      body: docs.isEmpty
          ? const EmptyView(title: 'No documents yet', message: 'Upload an ID proof (and your GST certificate if you gave a GSTIN). Only our verification team can see your documents.')
          : ListView(children: [
              const Padding(padding: EdgeInsets.all(16), child: Text('Only our verification team can see these.', style: TextStyle(color: Brand.muted))),
              for (final d in docs)
                ListTile(
                  leading: Icon(d.mimeType == 'application/pdf' ? Icons.picture_as_pdf_outlined : Icons.image_outlined),
                  title: Text(docKinds[d.kind] ?? d.kind),
                  subtitle: Text(switch (d.status) { 'ACCEPTED' => 'Accepted', 'REJECTED' => 'Rejected${d.note != null ? ': ${d.note}' : ''}', _ => 'Waiting for review' }),
                  trailing: d.status == 'ACCEPTED' || !(p?.editable ?? false)
                      ? null
                      : IconButton(
                          tooltip: 'Remove',
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () async {
                            try {
                              await ref.read(apiProvider).removeDocument(d.id);
                              ref.invalidate(profileProvider);
                            } catch (e) {
                              if (context.mounted) showError(context, e);
                            }
                          },
                        ),
                ),
            ]),
    );
  }
}
