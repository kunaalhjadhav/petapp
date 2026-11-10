import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/contests/contest_screens.dart';

import 'fixture.dart';

/// Contest models parse responses recorded from the real API (tool/record_contest_fixtures.py).
void main() {
  test('contest list and detail', () {
    final cards = (fixture('contests_live') as List).cast<Json>().map(ContestCard.fromJson).toList();
    final c = cards.firstWhere((x) => x.title.startsWith('Fixture Talent Cup'));
    expect(c.feePaise, 9900);
    expect(c.isFree, isFalse);
    expect(c.categoryName, 'Best Trick');
    expect(c.prizes.map((p) => p.rank), [1, null]);
    final d = ContestDetail.fromJson(fixture('contest_detail_open') as Json);
    expect(d.tasks.single.type, 'TEXT');
    expect(d.publicWeight, 100);
    expect(d.myEntries, isEmpty);
    expect(d.card.registrationClosesAt, isNotNull);
  });

  test('a paid registration carries a checkout until the payment is verified', () {
    final r = RegisterResult.fromJson(fixture('contest_register') as Json);
    expect(r.status, 'PENDING_PAYMENT');
    expect(r.payment!.amountPaise, 9900);
    expect(r.payment!.provider, 'fake');
    final pending = ContestDetail.fromJson(fixture('contest_detail_pending') as Json).myEntries.single;
    expect(pending.status, 'PENDING_PAYMENT');
    expect(pending.payment!.orderId, r.payment!.orderId);
    final entered = ContestDetail.fromJson(fixture('contest_detail_entered') as Json).myEntries.single;
    expect(entered.status, 'SUBMITTED');
    expect(entered.payment, isNull);
    expect(entered.submittedTaskIds, hasLength(1));
  });

  test('leaderboard', () {
    final b = Leaderboard.fromJson(fixture('contest_leaderboard') as Json);
    expect(b.frozen, isFalse);
    expect(b.rows.map((r) => r.rank), [1, 2]);
    expect(b.rows.first.pet!.name, isNotEmpty);
  });

  test('rupees use Indian digit grouping', () {
    expect(rupees(9900), '₹99');
    expect(rupees(19950), '₹199.50');
    expect(rupees(10000000), '₹1,00,000');
    expect(rupees(123456789), '₹12,34,567.89');
  });
}
