import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/contests/contest_screens.dart' show rupees;
import 'package:petapp/features/home/search_logic.dart';

import 'fixture.dart';

/// Search, discovery and locations (Phase 9c), against responses recorded from the real API
/// (tool/record_search_fixtures.py). scripts/check_search_mirrors.py runs the same checks in Python.
void main() {
  List<SearchHit> hits(String n) => (fixture(n) as List).cast<Json>().map(SearchHit.fromJson).toList();

  test('every kind of result opens somewhere', () {
    for (final n in ['search_pets', 'search_users', 'search_reels', 'search_products', 'search_services', 'search_partners', 'search_contests', 'search_challenges']) {
      final list = hits(n);
      expect(list, isNotEmpty, reason: n);
      for (final h in list) {
        expect(hitRoute(h.linkKind, h.linkKey), isNotNull, reason: '$n ${h.type}');
      }
    }
    expect(hitRoute('pet', 'bruno.ana'), '/pet/bruno.ana');
    expect(hitRoute('reel', 'r1'), '/post/r1');
    expect(hitRoute('service', 'pia'), '/service-partner/pia');
    expect(hitRoute('nope', 'x'), isNull);
    expect(hitRoute('pet', ''), isNull);
  });

  test('the All tab groups results by kind', () {
    final all = SearchAll.fromJson(fixture('search_all') as Json);
    expect(all.query, 'walk');
    expect(all.groups.first.type, 'challenges');
    expect(all.groups.first.items.first.type, 'CHALLENGE');
    final f = SearchFilters.fromJson(fixture('search_filters') as Json);
    expect(f.types, searchTypeOrder);
    expect(f.species, isNotEmpty);
    expect(f.serviceModes.map((m) => m.id), ['AT_CENTER', 'AT_HOME']);
    expect(f.challengeWhen.map((w) => w.id), ['active', 'upcoming', 'past']);
  });

  test('result rows show the fact that matters for each kind', () {
    final service = hits('search_services').first;
    expect(hitTrailing(service.type, service.meta, rupees), '₹849 · 100 m');
    final partner = hits('search_partners').first;
    expect(hitTrailing(partner.type, partner.meta, rupees), '★ 5.0 · 100 m');
    expect(hitTrailing('PRODUCT', {'fromPaise': 29900}, rupees), '₹299');
    expect(hitTrailing('CONTEST', {'entries': 1}, rupees), '1 entry');
    expect(hitTrailing('CHALLENGE', {'participants': 0}, rupees), '0 taking part');
    expect(hitTrailing('PET', {'followers': 0}, rupees), isNull);
    expect(hitTrailing('REEL', {'likes': 3}, rupees), '♥ 3');
    expect(hitTrailing('USER', const {}, rupees), isNull);
    expect(searchTypeLabel('partners'), 'Businesses');
  });

  test('filters are sent only for kinds that use them', () {
    expect(filterQuery('pets', speciesId: 's', categoryId: 'c'), {'speciesId': 's'});
    expect(filterQuery('services', categoryId: 'c', mode: 'AT_HOME', lat: 1, lng: 2), {'categoryId': 'c', 'mode': 'AT_HOME', 'lat': 1.0, 'lng': 2.0});
    expect(filterQuery('products', inStock: true, when: 'past'), {'inStock': 'true'});
    expect(filterQuery('contests', when: 'voting'), {'when': 'voting'});
    expect(filterQuery('users', speciesId: 's'), isEmpty);
    expect(addRecent(['Luna', 'groom'], 'luna'), ['luna', 'groom']);
    expect(addRecent(const [], 'a'), isEmpty);
    expect(addRecent(List.generate(8, (i) => 'q$i'), 'new').length, 8);
  });

  test('pets near you: opt-in, rounded distances, never coordinates', () {
    final near = (fixture('discover_nearby') as List).cast<Json>().map(Pet.fromJson).toList();
    expect(near, isNotEmpty);
    expect(near.every((p) => p.distanceKm != null && p.distanceKm! >= 1), isTrue);
    expect((fixture('discover_nearby') as List).cast<Json>().any((j) => j.containsKey('latitude')), isFalse);
    expect(petDistanceLabel(1), 'Within 1 km');
    expect(petDistanceLabel(3), '3 km away');
    final mine = Pet.fromJson(fixture('pet_view_owner_discoverable') as Json);
    expect(mine.discoverable, isTrue);
    expect(coarsePoint(19.07612, 72.87765), (lat: 19.08, lng: 72.88));
  });

  test('pets in contests and challenges', () {
    final c = (fixture('discover_contest_entries') as List).cast<Json>().map(ContestEntryCard.fromJson).single;
    expect(c.pet.name, 'Bagel');
    expect(c.contestId, isNotEmpty);
    final ch = (fixture('discover_challenge_entries') as List).cast<Json>().map(ChallengeEntryCard.fromJson).single;
    expect(ch.requiredCheckIns, 5);
    expect(challengeProgress(ch.checkIns, ch.requiredCheckIns), '0 of 5 check-ins');
    expect(challengeProgress(5, 5, completed: true), 'Completed');
    expect(CursorPage.fromJson(fixture('discover_reels') as Json, Post.fromJson).items, isNotEmpty);
  });

  test('locations: PIN codes, cities and coverage', () {
    final pin = PincodeInfo.fromJson(fixture('location_pincode') as Json);
    expect(pin.city, 'Mumbai');
    expect(pin.stateName, 'Maharashtra');
    expect(pin.locality, 'Bandra West');
    final cities = (fixture('location_cities') as List).cast<Json>().map(CityOption.fromJson).toList();
    expect(cities.map((c) => c.slug), contains('pune'));
    expect(Coverage.fromJson(fixture('location_coverage') as Json).covered, isTrue);
    final out = Coverage.fromJson(fixture('location_coverage_outside') as Json);
    expect(out.covered, isFalse);
    expect(out.nearestName, 'Mumbai');
  });

  test('checkout priced for an address follows its delivery zone', () {
    final ok = Cart.fromJson(fixture('shop_preview_delivery') as Json);
    expect(ok.delivery!.deliverable, isTrue);
    expect(ok.delivery!.line, 'Delivery in 1–2 days');
    expect(ok.shippingPaise, 0);
    final no = Cart.fromJson(fixture('shop_preview_undeliverable') as Json);
    expect(no.canCheckout, isFalse);
    expect(no.delivery!.problem, 'Paused for the monsoon.');
    expect(Cart.fromJson(fixture('shop_preview') as Json).delivery, isNull);
  });
}
