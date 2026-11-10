import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../config_share.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../../common/share_button.dart';
import '../safety/report_screen.dart';
import '../../services/location_service.dart';
import '../home/search_logic.dart';

final _petProvider = FutureProvider.autoDispose.family<Pet, String>((ref, id) => ref.watch(apiProvider).pet(id));

String petAge(int? months) {
  if (months == null) return '';
  if (months < 12) return '$months mo';
  final y = months ~/ 12;
  return '$y yr${y == 1 ? '' : 's'}';
}

class PetScreen extends ConsumerWidget {
  const PetScreen({super.key, required this.idOrHandle});
  final String idOrHandle;

  Future<void> _toggleFollow(BuildContext context, WidgetRef ref, Pet p) async {
    try {
      p.isFollowing ? await ref.read(apiProvider).unfollowPet(p.id) : await ref.read(apiProvider).followPet(p.id);
      ref.invalidate(_petProvider(idOrHandle));
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pet = ref.watch(_petProvider(idOrHandle));
    return Scaffold(
      appBar: AppBar(actions: [
        if (pet.valueOrNull case final p? when !p.restricted) ShareButton(kind: ShareKind.pet, linkKey: p.handle, text: 'Meet ${p.name} on PetApp'),
        if (pet.valueOrNull != null && !pet.value!.isOwner)
          IconButton(
            tooltip: 'Report',
            icon: const Icon(Icons.flag_outlined),
            onPressed: () async {
              await reportContent(context, 'PET', pet.value!.id, 'pet profile');
            },
          ),
      ]),
      body: pet.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_petProvider(idOrHandle))),
        data: (p) {
          final posts = p.restricted ? null : ref.watch(petPostsProvider(p.id));
          return CustomScrollView(slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Avatar(url: p.avatarUrl, name: p.name, size: 72),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Flexible(child: Text(p.name, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700))),
                          if (p.isVerified) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.verified_rounded, color: Brand.teal, size: 20)),
                        ]),
                        Text('@${p.handle}', style: const TextStyle(color: Brand.muted)),
                        const SizedBox(height: 4),
                        Text([p.breedName ?? p.speciesName, petAge(p.ageMonths), if (p.city != null) p.city!].where((s) => s.isNotEmpty).join(' · ')),
                      ]),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  Text('${compact(p.followerCount)} followers', style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (p.about != null) ...[const SizedBox(height: 8), Text(p.about!)],
                  if (p.personality.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(spacing: 6, children: [for (final t in p.personality) Chip(label: Text(t), visualDensity: VisualDensity.compact)]),
                  ],
                  if (p.isOwner && p.microchipId != null) ...[
                    const SizedBox(height: 8),
                    Text('Microchip ${p.microchipId} (only you can see this)', style: const TextStyle(color: Brand.muted, fontSize: 12)),
                  ],
                  if (p.isOwner && p.visibility == 'PUBLIC') _NearbySwitch(pet: p, onChanged: () => ref.invalidate(_petProvider(idOrHandle))),
                  if (p.owner != null && !p.isOwner)
                    TextButton(onPressed: () => context.push('/user/${p.owner!.id}'), child: Text('Owner: ${p.owner!.name ?? 'view profile'}')),
                  const SizedBox(height: 8),
                  if (!p.isOwner)
                    SizedBox(
                      width: double.infinity,
                      child: p.isFollowing
                          ? OutlinedButton(onPressed: () => _toggleFollow(context, ref, p), child: const Text('Following'))
                          : FilledButton(onPressed: () => _toggleFollow(context, ref, p), child: Text('Follow ${p.name}')),
                    ),
                ]),
              ),
            ),
            if (p.restricted)
              const SliverFillRemaining(hasScrollBody: false, child: EmptyView(title: 'This pet’s posts are for followers', message: 'Follow to see them.'))
            else if (posts != null) ...[
              PostGrid(posts: posts.items),
              if (posts.loadedOnce && posts.items.isEmpty) const SliverToBoxAdapter(child: EmptyView(title: 'No posts yet')),
              if (!posts.done) SliverToBoxAdapter(child: Builder(builder: (ctx) {
                ref.read(petPostsProvider(p.id).notifier).loadMoreSoon();
                return const LoadingView();
              })),
            ],
          ]);
        },
      ),
    );
  }
}

class PetFormScreen extends ConsumerStatefulWidget {
  const PetFormScreen({super.key});
  @override
  ConsumerState<PetFormScreen> createState() => _PetFormScreenState();
}

class _PetFormScreenState extends ConsumerState<PetFormScreen> {
  final _name = TextEditingController();
  final _about = TextEditingController();
  String? _speciesId;
  String? _breedId;
  String _gender = 'UNKNOWN';
  DateTime? _dob;
  bool _busy = false;

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _speciesId == null) {
      showMessage(context, 'Add a name and choose a species.');
      return;
    }
    setState(() => _busy = true);
    try {
      final pet = await ref.read(apiProvider).createPet({
        'name': _name.text.trim(),
        'speciesId': _speciesId,
        if (_breedId != null) 'breedId': _breedId,
        'gender': _gender,
        if (_dob != null) 'dateOfBirth': '${_dob!.year.toString().padLeft(4, '0')}-${_dob!.month.toString().padLeft(2, '0')}-${_dob!.day.toString().padLeft(2, '0')}',
        if (_about.text.trim().isNotEmpty) 'about': _about.text.trim(),
      });
      ref.invalidate(myPetsProvider);
      ref.invalidate(meProvider);
      if (mounted) context.pushReplacement('/pet/${pet.id}');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _about.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final species = ref.watch(speciesProvider);
    final breeds = _speciesId == null ? null : ref.watch(breedsProvider(_speciesId!));
    return Scaffold(
      appBar: AppBar(title: const Text('Add a pet')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _name, maxLength: 40, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name')),
        const SizedBox(height: 8),
        species.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(speciesProvider)),
          data: (list) => DropdownButtonFormField<String>(
            value: _speciesId,
            decoration: const InputDecoration(labelText: 'Species'),
            items: [for (final s in list) DropdownMenuItem(value: s.id, child: Text(s.name))],
            onChanged: (v) => setState(() {
              _speciesId = v;
              _breedId = null;
            }),
          ),
        ),
        const SizedBox(height: 16),
        if (breeds != null)
          breeds.when(
            loading: () => const LinearProgressIndicator(),
            error: (e, _) => const SizedBox.shrink(),
            data: (list) => list.isEmpty
                ? const SizedBox.shrink()
                : DropdownButtonFormField<String>(
                    value: _breedId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Breed (optional)'),
                    items: [for (final b in list) DropdownMenuItem(value: b.id, child: Text(b.name))],
                    onChanged: (v) => setState(() => _breedId = v),
                  ),
          ),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'MALE', label: Text('Male')), ButtonSegment(value: 'FEMALE', label: Text('Female')), ButtonSegment(value: 'UNKNOWN', label: Text('Not sure'))],
          selected: {_gender},
          showSelectedIcon: false,
          onSelectionChanged: (s) => setState(() => _gender = s.first),
        ),
        const SizedBox(height: 8),
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(_dob == null ? 'Birthday (optional)' : 'Born ${_dob!.day}/${_dob!.month}/${_dob!.year}'),
          trailing: const Icon(Icons.cake_outlined),
          onTap: () async {
            final now = DateTime.now();
            final d = await showDatePicker(context: context, firstDate: DateTime(now.year - 40), lastDate: now, initialDate: _dob ?? now);
            if (d != null) setState(() => _dob = d);
          },
        ),
        TextField(controller: _about, maxLength: 1000, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'About (optional)')),
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save pet')),
      ]),
    );
  }
}

/// The owner's "Show in Pets near you" switch (Phase 9c). Turning it on saves the phone's position rounded to
/// about 1 km; other people only ever see a rounded distance.
class _NearbySwitch extends ConsumerStatefulWidget {
  const _NearbySwitch({required this.pet, required this.onChanged});
  final Pet pet;
  final VoidCallback onChanged;
  @override
  ConsumerState<_NearbySwitch> createState() => _NearbySwitchState();
}

class _NearbySwitchState extends ConsumerState<_NearbySwitch> {
  bool _busy = false;

  Future<void> _set(bool on) async {
    setState(() => _busy = true);
    try {
      final body = <String, Object?>{'discoverable': on};
      if (on) {
        final here = await currentPosition();
        if (here == null) {
          if (mounted) showMessage(context, 'Turn on location so we can show ${widget.pet.name} to pets nearby.');
          return;
        }
        final p = coarsePoint(here.lat, here.lng);
        body['latitude'] = p.lat;
        body['longitude'] = p.lng;
      }
      await ref.read(apiProvider).updatePet(widget.pet.id, body);
      widget.onChanged();
      if (mounted) showMessage(context, on ? '${widget.pet.name} now shows in Pets near you.' : '${widget.pet.name} no longer shows in Pets near you.');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Show in Pets near you'),
        subtitle: const Text('People nearby see a rounded distance, never where you live.'),
        value: widget.pet.discoverable,
        onChanged: _busy ? null : _set,
      );
}
