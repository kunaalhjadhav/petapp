import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/home/home_screen.dart' show offerText;
import 'package:petapp/features/home/search_screen.dart' show hashtagFor;

import 'fixture.dart';

/// Home screen and recommendation models parse responses recorded from the real API (tool/record_home_fixtures.py).
void main() {
  HomeFeed home(String n) => HomeFeed.fromJson(fixture(n) as Json);

  test('the home screen: sections in order, each item parsed as its own model, with reasons', () {
    final h = home('home_personal');
    expect(h.personalised, isTrue);
    expect(h.sections, isNotEmpty);
    expect(h.sections.every((s) => s.items.isNotEmpty), isTrue);
    for (final s in h.sections) {
      final want = switch (s.kind) {
        'FEATURED_REELS' => Post,
        'TRENDING_PETS' => Pet,
        'ACTIVE_CONTESTS' => ContestCard,
        'CHALLENGES' => ChallengeCard,
        'NEARBY_SERVICES' => NearbyPartner,
        'RECOMMENDED_PRODUCTS' => ProductCard,
        'PARTNER_OFFERS' => HomeOffer,
        _ => UpcomingItem,
      };
      expect(s.items.every((p) => p.item.runtimeType == want), isTrue, reason: s.kind);
    }
    final reels = h.sections.firstWhere((s) => s.kind == 'FEATURED_REELS');
    expect(reels.items.first.reason, 'From someone you follow');
    final offer = h.sections.firstWhere((s) => s.kind == 'PARTNER_OFFERS').items.first.item as HomeOffer;
    expect(offer.code, startsWith('HOME'));
    expect(offerText(offer), '10% off (up to ₹200)');
    final up = h.sections.firstWhere((s) => s.kind == 'UPCOMING_EVENTS').items.map((p) => p.item as UpcomingItem);
    expect(up.every((u) => u.at != null && u.label.isNotEmpty && u.route.startsWith('/')), isTrue);
    expect(home('home_anon').personalised, isFalse);
  });

  test('sections of a kind this app doesn’t know, or with nothing in them, are left out', () {
    final h = HomeFeed.fromJson({
      'city': 'Pune',
      'personalised': false,
      'sections': [
        {'id': 'a', 'kind': 'SOMETHING_NEW', 'title': 'New', 'subtitle': null, 'items': [{'id': 'x'}]},
        {'id': 'b', 'kind': 'TRENDING_PETS', 'title': 'Pets', 'subtitle': null, 'items': []},
      ],
    });
    expect(h.sections, isEmpty);
    expect(HomeSectionView.dismissTarget('RECOMMENDED_PRODUCTS'), 'PRODUCT');
    expect(HomeSectionView.dismissTarget('PARTNER_OFFERS'), isNull);
  });

  test('recommended products and reels carry why they were picked', () {
    final picks = (fixture('reco_products') as List).cast<Json>().map((j) => Picked.fromJson(j, ProductCard.fromJson)).toList();
    expect(picks, isNotEmpty);
    expect(picks.first.reason, isNotNull);
    expect(picks.first.pinned, isFalse);
    final reels = CursorPage.fromJson(fixture('reco_reels') as Json, Post.fromJson);
    expect(reels.items.single.type, 'REEL');
  });

  test('personalisation settings', () {
    final on = RecoSettings.fromJson(fixture('reco_settings') as Json);
    expect(on.personalised, isTrue);
    expect(on.basedOn, hasLength(4));
    expect(on.viewsKept, greaterThan(0));
    final off = RecoSettings.fromJson(fixture('reco_settings_off') as Json);
    expect(off.personalised, isFalse);
    expect(off.basedOn, isEmpty);
    expect(off.viewsKept, 0); // turning it off deletes what was viewed
  });

  test('offers and hashtags in plain words', () {
    HomeOffer o(String kind, int value, {int? cap, int min = 0}) => HomeOffer(id: 'x', code: 'C', kind: kind, value: value, maxDiscountPaise: cap, minOrderPaise: min);
    expect(offerText(o('PERCENT', 1250)), '12.5% off');
    expect(offerText(o('FLAT', 10000, min: 50000)), '₹100 off on orders over ₹500');
    expect(hashtagFor('#Zoomies'), 'zoomies');
    expect(hashtagFor('beach'), 'beach');
    expect(hashtagFor('golden retriever'), isNull);
    expect(hashtagFor('#'), isNull);
  });
}
