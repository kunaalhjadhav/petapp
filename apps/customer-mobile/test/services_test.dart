import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/services/services_screens.dart';

import 'fixture.dart';

/// Services models parse real API responses (tool/record_services_fixtures.py), and times show in India time.
void main() {
  test('India time regardless of the phone’s time zone', () {
    final t = DateTime.utc(2026, 10, 8, 3, 30); // 09:00 IST
    expect(istTime(t), '9:00 am');
    expect(istDate(t), '2026-10-08');
    expect(istTime(DateTime.utc(2026, 10, 8, 18, 45)), '12:15 am'); // next day in India
    expect(istDate(DateTime.utc(2026, 10, 8, 18, 45)), '2026-10-09');
    expect(istDayLabel(t), 'Thu 8 Oct');
  });

  test('search, partner page and slots', () {
    final near = (fixture('services_nearby') as List).cast<Json>().map(NearbyPartner.fromJson).single;
    expect(near.fromPaise, 79900);
    expect(near.distanceKm, greaterThan(0));
    final p = PartnerPage.fromJson(fixture('service_partner') as Json);
    expect(p.services.single.atHome && p.services.single.atCenter, isTrue);
    expect(p.services.single.categoryName, 'Grooming');
    expect(p.hours, hasLength(7));
    final day = SlotDay.fromJson(fixture('service_slots') as Json);
    expect(day.durationMin, 60);
    expect(day.slots, isNotEmpty);
    expect(day.slots.first.endsAt.difference(day.slots.first.startsAt).inMinutes, 60);
    expect(istTime(day.slots.first.startsAt), '9:00 am'); // opens at 9 India time
  });

  test('booking lifecycle: pending with checkout, confirmed, cancelled with refund, completed and reviewed', () {
    final created = BookingView.fromJson(fixture('booking_create') as Json);
    expect(created.status, 'PENDING_PAYMENT');
    expect(created.code, startsWith('PB-'));
    expect(created.payment!.amountPaise, 79900);
    expect(created.canCancel, isTrue);
    final cancelled = BookingView.fromJson(fixture('booking_cancel') as Json);
    expect(cancelled.status, 'CANCELLED');
    expect(cancelled.refundPaise, 79900); // cancelled two days ahead: full refund
    expect(cancelled.mode, 'AT_HOME');
    expect(cancelled.addressLine, '5 Carter Road, Bandra');
    final done = BookingView.fromJson(fixture('booking_detail_completed') as Json);
    expect(done.status, 'COMPLETED');
    expect(done.reviewRating, 5);
    expect(done.canReview, isFalse);
    final reviews = (fixture('partner_reviews') as List).cast<Json>().map(ReviewView.fromJson).toList();
    expect(reviews.single.comment, 'Coco came back fluffy and calm. Thank you!');
  });
}
