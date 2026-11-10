import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../services/document_upload.dart';
import '../state/providers.dart';
import '../theme.dart';
import 'schedule.dart';
import 'services_screen.dart';
import 'terms.dart';

const docKinds = {
  'ID_PROOF': 'ID proof (Aadhaar, PAN, passport or voter ID)',
  'ADDRESS_PROOF': 'Address proof',
  'BUSINESS_REGISTRATION': 'Business registration',
  'GST_CERTIFICATE': 'GST certificate',
  'PROFESSIONAL_LICENSE': 'Professional licence (e.g. vet registration)',
  'OTHER': 'Other',
};

/// Where a new or not-yet-approved partner lands: a checklist to get verified.
class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key, required this.profile});
  final PartnerProfile? profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = profile;
    final banner = switch (p?.status) {
      'SUBMITTED' => ('Under review', 'Our team is checking your details and documents. You’ll get a notification when it’s done.', Brand.teal),
      'REJECTED' => ('Changes needed', p?.statusReason ?? 'Please update your details and submit again.', Brand.heart),
      'SUSPENDED' => ('Account paused', p?.statusReason ?? 'Contact partner support.', Brand.heart),
      _ => null,
    };
    Widget step(String title, String subtitle, bool done, Widget Function() page) => ListTile(
          leading: Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, color: done ? Brand.teal : Brand.muted),
          title: Text(title),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: p == null && title != 'Business details' ? null : () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page())),
        );
    return Scaffold(
      appBar: AppBar(title: const Text('Get verified'), actions: [IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout), onPressed: () => ref.read(authProvider.notifier).logout())]),
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
              child: Text('Complete these steps. Once our team verifies you, customers nearby can find and book you.', style: TextStyle(color: Brand.muted)),
            ),
          step('Business details', p == null ? 'Name, address and location' : p.businessName, p != null, () => ProfileFormScreen(profile: p)),
          if (p != null) ...[
            step('Documents', p.documents.isEmpty ? 'Upload an ID proof' : '${p.documents.length} uploaded', p.documents.any((d) => d.kind == 'ID_PROOF'), () => const DocumentsScreen()),
            step('Services and prices', p.services.isEmpty ? 'Add what you offer' : '${p.services.length} service${p.services.length == 1 ? '' : 's'}', p.services.isNotEmpty, () => const ServicesScreen()),
            step('Opening hours', p.hours.isEmpty ? 'When customers can book you' : '${p.hours.map((h) => h.weekday).toSet().length} days a week', p.hours.isNotEmpty, () => const ScheduleScreen()),
            if (p.checklist.isNotEmpty && p.editable)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Text('Still needed: ${p.checklist.join(' ')}', style: const TextStyle(color: Brand.muted)),
              ),
            if (p.editable)
              Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton(
                  onPressed: p.checklist.isNotEmpty
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
                            if (context.mounted) showMessage(context, 'Submitted. We’ll let you know once you’re verified.');
                          } catch (e) {
                            if (context.mounted) showError(context, e);
                          }
                        },
                  child: Text(p.status == 'REJECTED' ? 'Submit again' : 'Submit for verification'),
                ),
              ),
          ],
        ]),
      ),
    );
  }
}

class ProfileFormScreen extends ConsumerStatefulWidget {
  const ProfileFormScreen({super.key, this.profile});
  final PartnerProfile? profile;
  @override
  ConsumerState<ProfileFormScreen> createState() => _ProfileFormState();
}

class _ProfileFormState extends ConsumerState<ProfileFormScreen> {
  late final p = widget.profile;
  late final _c = {
    'businessName': TextEditingController(text: p?.businessName),
    'about': TextEditingController(text: p?.about),
    'phone': TextEditingController(text: p?.phone.replaceFirst('+91', '')),
    'email': TextEditingController(text: p?.email),
    'addressLine': TextEditingController(text: p?.addressLine),
    'area': TextEditingController(text: p?.area),
    'city': TextEditingController(text: p?.city),
    'state': TextEditingController(text: p?.state),
    'pincode': TextEditingController(text: p?.pincode),
    'gstin': TextEditingController(text: p?.gstin),
    'radius': TextEditingController(text: '${p?.homeVisitRadiusKm ?? 0}'),
  };
  late String _kind = p?.kind ?? 'INDIVIDUAL';
  late double? _lat = p?.lat;
  late double? _lng = p?.lng;
  bool _busy = false;

  Future<void> _locate() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        if (mounted) showMessage(context, 'Allow location access to set your address on the map.');
        return;
      }
      final pos = await Geolocator.getCurrentPosition();
      setState(() {
        _lat = pos.latitude;
        _lng = pos.longitude;
      });
    } catch (_) {
      if (mounted) showMessage(context, 'Couldn’t get your location. Try again outdoors or with GPS on.');
    }
  }

  Future<void> _save() async {
    if (_lat == null || _lng == null) return showMessage(context, 'Set your location so customers nearby can find you.');
    String? v(String k) => _c[k]!.text.trim().isEmpty ? null : _c[k]!.text.trim();
    final body = <String, Object?>{
      'businessName': v('businessName'), 'kind': _kind, 'about': v('about'), 'phone': v('phone'), 'email': v('email'),
      'addressLine': v('addressLine'), 'area': v('area'), 'city': v('city'), 'state': v('state'), 'pincode': v('pincode'),
      'lat': _lat, 'lng': _lng, 'homeVisitRadiusKm': int.tryParse(_c['radius']!.text) ?? 0, 'gstin': v('gstin')?.toUpperCase(),
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
    Widget f(String k, String label, {TextInputType? type, int lines = 1, String? hint}) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextField(controller: _c[k], keyboardType: type, minLines: lines, maxLines: lines, decoration: InputDecoration(labelText: label, helperText: hint)),
        );
    final locked = p != null && !p!.editable && p!.status != 'APPROVED';
    return Scaffold(
      appBar: AppBar(title: const Text('Business details')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (locked) const Padding(padding: EdgeInsets.only(bottom: 12), child: Text('Your details are under review and can’t be changed right now.', style: TextStyle(color: Brand.muted))),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'INDIVIDUAL', label: Text('Individual')), ButtonSegment(value: 'BUSINESS', label: Text('Business'))],
          selected: {_kind},
          showSelectedIcon: false,
          onSelectionChanged: (s) => setState(() => _kind = s.first),
        ),
        const SizedBox(height: 16),
        f('businessName', 'Business or display name'),
        f('about', 'About you', lines: 3, hint: 'Experience, specialities, what to expect'),
        f('phone', 'Business phone', type: TextInputType.phone),
        f('email', 'Email (optional)', type: TextInputType.emailAddress),
        f('addressLine', 'Address'),
        f('area', 'Area or locality'),
        f('city', 'City'),
        f('state', 'State'),
        f('pincode', 'PIN code', type: TextInputType.number),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.my_location, color: Brand.teal),
          title: Text(_lat == null ? 'Set location' : 'Location set (${_lat!.toStringAsFixed(4)}, ${_lng!.toStringAsFixed(4)})'),
          subtitle: const Text('Stand at your business and tap to use this phone’s location.'),
          onTap: _locate,
        ),
        f('radius', 'Home-visit distance (km)', type: TextInputType.number, hint: '0 if you don’t do home visits'),
        f('gstin', 'GSTIN (optional)', hint: '15 characters, e.g. 27ABCDE1234F1Z5'),
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
    final docs = p?.documents ?? const <PartnerDocument>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Documents')),
      floatingActionButton: p != null && p.editable ? FloatingActionButton.extended(onPressed: () => _add(context, ref), icon: const Icon(Icons.upload_file), label: const Text('Upload')) : null,
      body: docs.isEmpty
          ? const EmptyView(title: 'No documents yet', message: 'Upload an ID proof to get verified. Only our verification team can see your documents.')
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
