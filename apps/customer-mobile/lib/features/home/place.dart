import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/location_service.dart';
import '../../state/providers.dart';
import 'place_logic.dart';

export 'place_logic.dart' show cityOfLabel, nearYouLabel;

/// Where the person is looking from: the phone's position ("Near you") or a city they chose.
/// Shared by the home screen, services search and the booking screen (home-visit addresses).
final searchPlaceProvider = StateProvider<({String label, LatLng at})?>((_) => null);

/// The chosen city's name, for city-targeted home sections (null for the phone's position).
String? placeCity(({String label, LatLng at})? place) => cityOfLabel(place?.label);

/// Asks for the phone's position once, if no place is set yet. Returns quietly when location is off.
Future<void> locateOnce(WidgetRef ref) async {
  if (ref.read(searchPlaceProvider) != null) return;
  final here = await currentPosition();
  if (here != null && ref.read(searchPlaceProvider) == null) ref.read(searchPlaceProvider.notifier).state = (label: await _nameFor(ref, here), at: here);
}

/// "Near Koregaon Park" when the area is known, else "Near you". Never blocks on a slow connection.
Future<String> _nameFor(WidgetRef ref, LatLng at) async {
  try {
    return nearLabel(await ref.read(apiProvider).areaAt(at.lat, at.lng).timeout(const Duration(seconds: 4)));
  } catch (_) {
    return nearYouLabel;
  }
}

/// Where to look: "Use my location", a search for a city, area, landmark or PIN code (PetApp's locations, then
/// the map provider), or PetApp's cities (a built-in list when they can't be loaded). Returns true when it changed.
Future<bool> pickPlace(BuildContext context, WidgetRef ref) async {
  final picked = await showModalBottomSheet<_Pick>(context: context, showDragHandle: true, isScrollControlled: true, builder: (_) => const _PlaceSheet());
  if (picked == null) return false;
  if (picked.here) {
    final here = await currentPosition();
    if (here == null) {
      if (context.mounted) showMessage(context, 'Location is off or not allowed. Search for your area or choose a city instead.');
      return false;
    }
    ref.read(searchPlaceProvider.notifier).state = (label: await _nameFor(ref, here), at: here);
  } else {
    ref.read(searchPlaceProvider.notifier).state = (label: picked.label, at: picked.at);
  }
  return true;
}

typedef _Pick = ({bool here, String label, LatLng at});

class _PlaceSheet extends ConsumerStatefulWidget {
  const _PlaceSheet();
  @override
  ConsumerState<_PlaceSheet> createState() => _PlaceSheetState();
}

class _PlaceSheetState extends ConsumerState<_PlaceSheet> {
  late final Future<List<({String name, LatLng at})>> _cities = ref.read(apiProvider).cities().then(
        (list) => [for (final c in list) (name: c.name, at: (lat: c.lat, lng: c.lng))],
        onError: (Object _) => [for (final e in fallbackCities.entries) (name: e.key, at: e.value)],
      );
  Timer? _debounce;
  String _q = '';
  List<PlaceHit>? _hits;
  bool _searching = false;
  String? _error;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _changed(String v) {
    _debounce?.cancel();
    setState(() => _q = v.trim());
    if (!worthSearching(v)) {
      setState(() => _hits = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () => _search(v.trim()));
  }

  Future<void> _search(String q) async {
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final r = await ref.read(apiProvider).searchPlaces(q);
      if (mounted && q == _q) setState(() => _hits = r);
    } catch (e) {
      if (mounted && q == _q) setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  void _pick(String label, LatLng at) => Navigator.pop<_Pick>(context, (here: false, label: label, at: at));

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.75),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  autofocus: false,
                  textInputAction: TextInputAction.search,
                  onChanged: _changed,
                  decoration: InputDecoration(
                    hintText: 'Search area, landmark or PIN code',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _searching ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))) : null,
                  ),
                ),
              ),
              Flexible(child: _hits != null || _error != null ? _results() : _cityList()),
            ]),
          ),
        ),
      );

  Widget _results() => ListView(shrinkWrap: true, children: [
        if (_error != null) ListTile(leading: const Icon(Icons.error_outline), title: Text(_error!)),
        if (_hits != null && _hits!.isEmpty)
          ListTile(leading: const Icon(Icons.travel_explore), title: Text('No places match “$_q”.'), subtitle: const Text('Try a nearby area, the city name or a 6-digit PIN code.')),
        for (final h in _hits ?? const <PlaceHit>[])
          ListTile(
            leading: Icon(switch (h.kind) { 'CITY' => Icons.location_city, 'PINCODE' => Icons.markunread_mailbox_outlined, _ => Icons.place_outlined }),
            title: Text(h.label),
            subtitle: h.detail.isEmpty ? null : Text(h.detail),
            onTap: () => _pick(placeLabel(h), (lat: h.lat, lng: h.lng)),
          ),
      ]);

  Widget _cityList() => FutureBuilder<List<({String name, LatLng at})>>(
        future: _cities,
        builder: (ctx, snap) => ListView(shrinkWrap: true, children: [
          ListTile(leading: const Icon(Icons.my_location), title: const Text('Use my location'), onTap: () => Navigator.pop<_Pick>(context, (here: true, label: '', at: (lat: 0.0, lng: 0.0)))),
          if (!snap.hasData) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
          for (final c in snap.data ?? const <({String name, LatLng at})>[]) ListTile(title: Text(c.name), onTap: () => _pick(c.name, c.at)),
        ]),
      );
}

