import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_partner/api/models.dart';
import 'package:petapp_partner/features/reviews/reviews_logic.dart';

import 'fixture.dart';

/// Reviews of the business (Phase 9b), against responses recorded by apps/customer-mobile/tool/record_review_fixtures.py.
/// reviews_logic.dart is the same file as the customer app's (scripts/check_reviews_mirrors.py checks it).
void main() {
  test('the rating and what still needs a reply', () {
    final o = ReviewsOverview.fromJson(fixture('partner_reviews_summary') as Json);
    expect(o.summary.stars.map((s) => s.stars), [5, 4, 3, 2, 1]);
    expect(o.summary.stars.fold<int>(0, (a, s) => a + s.count), o.summary.count);
    expect(o.unanswered, greaterThan(0));
    expect(ratingLine(o.summary.avg, o.summary.count), startsWith('★ '));
  });

  test('a review of a visit, with its booking and photo', () {
    final r = (fixture('partner_reviews_mine') as List).cast<Json>().map(BusinessReview.fromJson).first;
    expect(r.canReply, isTrue);
    expect(r.bookingCode, isNotNull);
    expect(r.serviceName, isNotNull);
    expect(r.productTitle, isNull);
    expect(r.about, contains('booking ${r.bookingCode}'));
    expect(r.photos.single.isReady, isTrue);
    expect(r.by, matches(RegExp(r'^\S+( \S\.)?$')));
    expect((fixture('partner_review_reply') as Json)['reply'], isNotEmpty);
    expect(replyProblem('ok'), isNull);
  });
}
