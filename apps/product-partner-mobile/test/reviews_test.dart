import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_seller/api/models.dart';
import 'package:petapp_seller/features/reviews/reviews_logic.dart';

import 'fixture.dart';

/// Reviews of the store (Phase 9b), against responses recorded by apps/customer-mobile/tool/record_review_fixtures.py.
/// reviews_logic.dart is the same file as the customer app's (scripts/check_reviews_mirrors.py checks it).
void main() {
  test('the rating and what still needs a reply', () {
    final o = ReviewsOverview.fromJson(fixture('vendor_reviews_summary') as Json);
    expect(o.summary.stars.map((s) => s.stars), [5, 4, 3, 2, 1]);
    expect(o.summary.stars.fold<int>(0, (a, s) => a + s.count), o.summary.count);
    expect(o.unanswered, greaterThan(0));
  });

  test('reviews of products, before and after a reply', () {
    final open = (fixture('vendor_reviews') as List).cast<Json>().map(BusinessReview.fromJson).toList();
    expect(open.every((r) => r.canReply), isTrue);
    final r = open.first;
    expect(r.productTitle, isNotNull);
    expect(r.orderCode, isNotNull);
    expect(r.about, contains('order ${r.orderCode}'));
    final all = (fixture('vendor_reviews_all') as List).cast<Json>().map(BusinessReview.fromJson).toList();
    final replied = all.firstWhere((x) => x.reply != null);
    expect(replied.canReply, isFalse);
    expect(replied.repliedAt, isNotNull);
    expect(starsText(replied.rating).length, 5);
  });
}
