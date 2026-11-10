import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/notifications/notifications_screen.dart';
import 'package:petapp/features/reviews/reviews_logic.dart';

import 'fixture.dart';

/// Reviews and reports (Phase 9b), against responses recorded from the real API (tool/record_review_fixtures.py).
/// scripts/check_reviews_mirrors.py runs the same checks in Python where Flutter isn't installed.
void main() {
  test('a product page with its rating, breakdown and latest reviews', () {
    final p = ProductDetail.fromJson(fixture('shop_product_reviewed') as Json);
    expect(p.ratingCount, 1);
    expect(p.ratingAvg, 4);
    final s = p.ratingSummary!;
    expect(s.stars.map((x) => x.stars), [5, 4, 3, 2, 1]);
    expect(s.stars.fold<int>(0, (a, x) => a + x.count), s.count);
    expect(s.share(4), 1);
    final r = p.reviews.single;
    expect(r.by, 'Riya S.');
    expect(r.verified, isTrue);
    expect(r.photos.single.isReady, isTrue);
    expect(r.reply, startsWith('Thank you'));
    // The older page without reviews still parses.
    final plain = ProductDetail.fromJson(fixture('shop_product') as Json);
    expect(plain.reviews, isEmpty);
    expect(plain.ratingSummary, isNull);
  });

  test('cards carry the rating, and lists page', () {
    final cards = (fixture('shop_products_rated') as List).cast<Json>().map(ProductCard.fromJson).toList();
    expect(cards.first.ratingCount, greaterThan(0));
    final list = (fixture('product_reviews') as List).cast<Json>().map(ReviewView.fromJson).toList();
    expect(list, isNotEmpty);
    expect(list.every((r) => r.rating >= 1 && r.rating <= 5), isTrue);
    final withPhotos = (fixture('product_reviews_photos') as List).cast<Json>().map(ReviewView.fromJson).toList();
    expect(withPhotos.every((r) => r.photos.isNotEmpty), isTrue);
  });

  test('order items say whether they can be reviewed', () {
    final before = ShopOrder.fromJson(fixture('shop_order_delivered') as Json).parcels.first.items.first;
    expect(before.canReview, isTrue);
    expect(before.productId, isNotNull);
    expect(before.reviewRating, isNull);
    final after = ShopOrder.fromJson(fixture('shop_order_reviewed') as Json).parcels.first.items.first;
    expect(after.canReview, isFalse);
    expect(after.reviewRating, 4);
    final mine = ReviewView.fromJson(fixture('product_review_mine') as Json);
    expect(mine.status, 'VISIBLE');
    expect(mine.hidden, isFalse);
  });

  test('a service review with a photo, and the partner page', () {
    final b = BookingView.fromJson(fixture('booking_review_photo') as Json);
    expect(b.canReview, isFalse);
    expect(b.review!.rating, 5);
    expect(b.review!.photos, hasLength(1));
    final replied = BookingView.fromJson(fixture('booking_detail_reviewed') as Json);
    expect(replied.review!.reply, isNotNull);
    final page = PartnerPage.fromJson(fixture('service_partner_reviewed') as Json);
    expect(page.ratingSummary!.count, page.ratingCount);
    expect(page.reviews.first.verified, isTrue);
  });

  test('review helpers', () {
    expect(starsText(4), '★★★★☆');
    expect(starsText(9), '★★★★★');
    expect(ratingLine(4.25, 12), '★ 4.3 · 12 reviews');
    expect(ratingLine(5, 1), '★ 5.0 · 1 review');
    expect(ratingLine(0, 0), 'No reviews yet');
    expect(ratingWord(0), 'Tap a star');
    expect(ratingWord(5), 'Excellent');
    expect(reviewHint(1), startsWith('What went wrong?'));
    expect(reviewFilter('photos'), {'photos': 'true'});
    expect(reviewFilter('3'), {'stars': 3});
    expect(reviewFilter('all'), isEmpty);
    expect(reviewFilter('9'), isEmpty);
    expect(replyProblem(' a '), 'Write a reply first.');
    expect(replyProblem('Thanks!'), isNull);
    expect(replyProblem('x' * 1001), 'Keep it under 1,000 characters.');
    expect(starShares([1, 1, 1, 0, 0]), [34, 33, 33, 0, 0]);
    expect(starShares([0, 0, 0, 0, 0]), [0, 0, 0, 0, 0]);
    expect(starShares([2, 1, 0, 0, 0]).fold<int>(0, (a, b) => a + b), 100);
    final now = DateTime(2026, 10, 18, 12);
    expect(reviewDate(DateTime(2026, 10, 18, 1), now), 'Today');
    expect(reviewDate(DateTime(2026, 10, 17, 23), now), 'Yesterday');
    expect(reviewDate(DateTime(2026, 10, 14), now), '4 days ago');
    expect(reviewDate(DateTime(2026, 3, 2), now), '2 Mar');
    expect(reviewDate(DateTime(2025, 12, 31), now), '31 Dec 2025');
  });

  test('a seller’s reply opens the product', () {
    expect(routeFor('Product', 'p1'), '/product/p1');
  });
}
