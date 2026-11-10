import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/api_client.dart';
import '../../common/widgets.dart';
import '../../services/upload_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';

class CreateScreen extends ConsumerStatefulWidget {
  const CreateScreen({super.key});
  @override
  ConsumerState<CreateScreen> createState() => _CreateScreenState();
}

class _CreateScreenState extends ConsumerState<CreateScreen> {
  final _picker = ImagePicker();
  final _caption = TextEditingController();
  List<XFile> _files = [];
  bool _isReel = false;
  final Set<String> _petIds = {};
  bool _followersOnly = false;
  double? _progress;
  /// What was already sent when the connection dropped (spec §84): Retry carries on from there.
  Map<int, String> _sent = const {};
  bool _paused = false;

  Future<void> _pickPhotos() async {
    // imageQuality makes the picker export JPEG (no HEIC) at a sensible size.
    final picked = await _picker.pickMultiImage(imageQuality: 90, maxWidth: 2160, limit: 10);
    if (picked.isNotEmpty) setState(() {
      _files = picked.take(10).toList();
      _isReel = false;
      _sent = const {};
      _paused = false;
    });
  }

  Future<void> _pickVideo() async {
    final v = await _picker.pickVideo(source: ImageSource.gallery, maxDuration: const Duration(seconds: 60));
    if (v != null) setState(() {
      _files = [v];
      _isReel = true;
      _sent = const {};
      _paused = false;
    });
  }

  Future<void> _post() async {
    if (_files.isEmpty) return;
    final api = ref.read(apiProvider);
    setState(() {
      _progress = 0;
      _paused = false;
    });
    try {
      final ids = await UploadService(api).uploadAll(_files, resume: _sent, onProgress: (p) => setState(() => _progress = p));
      final post = await api.createPost({
        'type': _isReel ? 'REEL' : 'PHOTO',
        'mediaIds': ids,
        if (_caption.text.trim().isNotEmpty) 'caption': _caption.text.trim(),
        if (_petIds.isNotEmpty) 'petIds': _petIds.toList(),
        'visibility': _followersOnly ? 'FOLLOWERS' : 'PUBLIC',
      });
      if (!mounted) return;
      ref.invalidate(feedProvider(FeedKind.following));
      setState(() {
        _files = [];
        _caption.clear();
        _petIds.clear();
        _progress = null;
        _sent = const {};
      });
      showMessage(context, post.status == 'PUBLISHED' ? 'Posted!' : 'Uploaded. We’ll notify you when it’s live.');
      context.go('/home');
    } on UploadInterrupted catch (e) {
      if (!mounted) return;
      setState(() {
        _sent = e.sent;
        _paused = true;
        _progress = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _progress = null);
      showError(context, e);
    }
  }

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pets = ref.watch(myPetsProvider);
    final busy = _progress != null;
    return Scaffold(
      appBar: AppBar(title: const Text('New post'), actions: [
        TextButton(onPressed: _files.isEmpty || busy ? null : _post, child: const Text('Share')),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (_paused && !busy) ...[
          Card(
            color: const Color(0xFFFFF4E0),
            child: ListTile(
              leading: const Icon(Icons.wifi_off_rounded),
              title: const Text('Upload paused'),
              subtitle: const Text('The connection dropped. What was sent is kept: Retry carries on where it stopped.'),
              trailing: TextButton(onPressed: _post, child: const Text('Retry')),
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (busy) ...[
          LinearProgressIndicator(value: _progress),
          const SizedBox(height: 8),
          Text('Uploading ${(_progress! * 100).round()}%', style: const TextStyle(color: Brand.muted)),
          const SizedBox(height: 16),
        ],
        if (_files.isEmpty)
          Row(children: [
            Expanded(child: _PickTile(icon: Icons.photo_library_outlined, label: 'Photos', hint: 'Up to 10', onTap: _pickPhotos)),
            const SizedBox(width: 12),
            Expanded(child: _PickTile(icon: Icons.movie_creation_outlined, label: 'Reel', hint: 'Up to 60 s', onTap: _pickVideo)),
          ])
        else
          SizedBox(
            height: 120,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _files.length + 1,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (ctx, i) {
                if (i == _files.length) {
                  return OutlinedButton(onPressed: busy ? null : () => setState(() => _files = []), child: const Text('Change'));
                }
                return ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: _isReel
                      ? Container(width: 90, color: Brand.ink, child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 40))
                      : Image.file(File(_files[i].path), width: 90, height: 120, fit: BoxFit.cover),
                );
              },
            ),
          ),
        const SizedBox(height: 16),
        TextField(
          controller: _caption,
          maxLength: 2200,
          minLines: 3,
          maxLines: 6,
          enabled: !busy,
          decoration: const InputDecoration(hintText: 'Write a caption. Use #hashtags and @pet handles.'),
        ),
        const SizedBox(height: 8),
        Text('Who’s in it?', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        pets.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => Text(ApiException.from(e).message),
          data: (list) => list.isEmpty
              ? TextButton.icon(onPressed: () => context.push('/pets/new'), icon: const Icon(Icons.add), label: const Text('Add your pet first'))
              : Wrap(spacing: 8, children: [
                  for (final p in list)
                    FilterChip(
                      label: Text(p.name),
                      selected: _petIds.contains(p.id),
                      onSelected: busy ? null : (on) => setState(() => on ? _petIds.add(p.id) : _petIds.remove(p.id)),
                    ),
                ]),
        ),
        const SizedBox(height: 8),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Followers only'),
          subtitle: const Text('Only people who follow you can see this post.'),
          value: _followersOnly,
          onChanged: busy ? null : (v) => setState(() => _followersOnly = v),
        ),
      ]),
    );
  }
}

class _PickTile extends StatelessWidget {
  const _PickTile({required this.icon, required this.label, required this.hint, required this.onTap});
  final IconData icon;
  final String label;
  final String hint;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          height: 140,
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.line)),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, size: 36, color: Brand.teal),
            const SizedBox(height: 8),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(hint, style: const TextStyle(color: Brand.muted, fontSize: 12)),
          ]),
        ),
      );
}
