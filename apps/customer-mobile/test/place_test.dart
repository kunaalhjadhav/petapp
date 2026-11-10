import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/home/place_logic.dart';

import 'fixture.dart';

List<PlaceHit> hits(String name) => ((fixture(name) as Json)['places'] as List).cast<Json>().map(PlaceHit.fromJson).toList();

/// Choosing where to look (spec §19), against responses recorded from the real API (tool/record_place_fixtures.py).
/// scripts/check_place_mirrors.py runs the same checks in Python.
void main() {
  test('a PIN code finds its area', () {
    final h = hits('location_search_pin').single;
    expect(h.kind, 'PINCODE');
    expect(h.pincode, '400050');
    expect(placeLabel(h), 'Bandra West, Mumbai');
    expect(cityOfLabel(placeLabel(h)), 'Mumbai');
  });

  test('areas carry their city; cities stand alone', () {
    final area = hits('location_search_area').firstWhere((h) => h.kind == 'LOCALITY');
    expect(placeLabel(area), 'Bandra West, Mumbai');
    expect(area.fromMaps, isFalse);
    final city = hits('location_search_city').first;
    expect(placeLabel(city), 'Mumbai');
    expect(cityOfLabel('Mumbai'), 'Mumbai');
  });

  test('the phone’s own position is never a city', () {
    expect(nearLabel(null), nearYouLabel);
    expect(nearLabel('Koregaon Park'), 'Near Koregaon Park');
    expect(cityOfLabel(nearYouLabel), isNull);
    expect(cityOfLabel('Near Koregaon Park'), isNull);
    expect(cityOfLabel(null), isNull);
  });

  test('searches start once there is something to search', () {
    expect(worthSearching('b'), isFalse);
    expect(worthSearching('ba'), isTrue);
    expect(worthSearching('4000'), isFalse);
    expect(worthSearching('400050'), isTrue);
  });
}
