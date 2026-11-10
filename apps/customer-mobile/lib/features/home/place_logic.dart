// Pure rules for choosing where to look (spec §19). Mirrored in scripts/check_place_mirrors.py.
import '../../api/models.dart';

const nearYouLabel = 'Near you';

/// What the header shows for a chosen place: "Pune", "Koregaon Park, Pune", "Bandra West, Mumbai".
String placeLabel(PlaceHit h) => h.kind == 'CITY' || h.city == null || h.city == h.label || h.label.endsWith(', ${h.city}') ? h.label : '${h.label}, ${h.city}';

/// The city in a place label, for city-targeted home sections; null for the phone's own position.
String? cityOfLabel(String? label) {
  if (label == null || label == nearYouLabel || label.startsWith('Near ')) return null;
  final i = label.lastIndexOf(', ');
  return i < 0 ? label : label.substring(i + 2);
}

/// The phone's position, named when PetApp or the map provider knows the area ("Near Koregaon Park").
String nearLabel(String? area) => area == null || area.isEmpty ? nearYouLabel : 'Near $area';

/// Search only once something worth searching is typed: two letters, or digits on their way to a PIN code.
bool worthSearching(String q) {
  final t = q.trim();
  if (RegExp(r'^\d+$').hasMatch(t)) return t.length == 6;
  return t.length >= 2;
}
