import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_partner/api/models.dart';
import 'package:petapp_partner/common/widgets.dart';
import 'package:petapp_partner/features/legal_markdown.dart';

import 'fixture.dart';

/// The partner app's models parse responses recorded from the real API (tool/record_fixtures.py).
void main() {
  PartnerProfile profile(String n) => PartnerProfile.fromJson(fixture(n) as Json);
  List<Booking> bookings(String n) => (fixture(n) as List).cast<Json>().map(Booking.fromJson).toList();

  test('onboarding fills the checklist step by step', () {
    final created = profile('profile_created');
    expect(created.status, 'DRAFT');
    expect(created.editable, isTrue);
    expect(created.checklist, ['Upload an ID proof.', 'Add at least one service.', 'Set your opening hours.']);
    expect(profile('profile_with_document').documents.single.status, 'PENDING');
    final svc = profile('profile_with_service').services.single;
    expect(svc.pricePaise, 79900);
    expect(svc.modes, ['AT_CENTER', 'AT_HOME']);
    expect(svc.categoryName, 'Grooming');
    expect(profile('profile_with_hours').hours, hasLength(7));
    expect(profile('profile_with_time_off').timeOff.single.reason, 'Family function');
    expect(profile('profile_submitted').status, 'SUBMITTED');
  });

  test('an approved partner is live, with the edited price and an accepted ID', () {
    final p = profile('profile_approved');
    expect(p.live, isTrue);
    expect(p.editable, isFalse);
    expect(p.checklist, isEmpty);
    expect(p.services.single.pricePaise, 84900);
    expect(p.documents.single.status, 'ACCEPTED');
    expect(p.commissionBps, isNull); // no agreed rate: the category's standard fee applies
    expect(p.feeBpsFor(p.services.single), 1500);
    expect(p.services.single.categoryCommissionBps, 1500);
    expect(p.lat, closeTo(19.0596, 1e-6));
  });

  test('bookings carry the customer, the note and the partner’s share', () {
    final up = bookings('bookings_upcoming');
    expect(up, hasLength(2));
    final b = up.firstWhere((x) => x.petName == 'Coco');
    expect(b.status, 'CONFIRMED');
    expect(b.customerName, 'Asha Customer');
    expect(b.customerPhone, isNotNull);
    expect(b.customerNote, 'Gentle with the ears please');
    expect(b.earningPaise + b.feePaise, b.pricePaise); // every rupee is a fee or the partner's
    expect(b.canStart, isTrue);
    expect(Booking.fromJson(fixture('booking_started') as Json).status, 'IN_PROGRESS');
    expect(Booking.fromJson(fixture('booking_completed') as Json).status, 'COMPLETED');
    final cancelled = Booking.fromJson(fixture('booking_cancelled') as Json);
    expect(cancelled.status, 'CANCELLED');
    expect(cancelled.cancelReason, 'Groomer unwell today');
    expect(cancelled.refundPaise, cancelled.pricePaise); // partner cancellations refund in full
  });

  test('earnings add up', () {
    final e = Earnings.fromJson(fixture('earnings') as Json);
    expect(e.completed.visits, 1);
    expect(e.completed.grossPaise, 84900);
    expect(e.completed.platformFeesPaise + e.completed.earnedPaise, e.completed.grossPaise);
    expect(e.months.single.earnedPaise, e.completed.earnedPaise);
  });

  test('formatting', () {
    expect(rupees(84900), '₹849');
    expect(rupees(12735), '₹127.35');
    expect(rupees(7216500), '₹72,165');
    expect(rupees(10000000), '₹1,00,000');
    expect(percent(1500), '15%');
    expect(percent(1250), '12.5%');
    expect(clock(540), '9:00 am');
    expect(clock(1080), '6:00 pm');
    expect(clock(0), '12:00 am');
    expect(clock(750), '12:30 pm');
  });

  test('payout account: a UPI ID the bank has in the business’s name, then a replacement on a safety hold', () {
    expect(PayoutAccounts.fromJson(fixture('payout_account_none') as Json).active, isNull);
    final upi = PayoutAccounts.fromJson(fixture('payout_account_verified') as Json).active!;
    expect(upi.method, 'UPI');
    expect(upi.label, upi.vpa);
    expect(upi.nameMatches, isTrue); // the business name counts as the partner's own
    expect(upi.onHoldAt(upi.payableFrom!), isFalse);
    final replaced = PayoutAccounts.fromJson(fixture('payout_account_replaced') as Json).active!;
    expect(replaced.label, 'Bank •••• 4567');
    expect(replaced.onHoldAt(replaced.payableFrom!.subtract(const Duration(hours: 1))), isTrue);
    final summary = PayoutSummary.fromJson(fixture('payouts_on_hold') as Json);
    expect(summary.accountLabel, 'Bank •••• 4567');
    expect(summary.accountPayableFrom, replaced.payableFrom);
    // The earlier payout went to the UPI ID that was replaced.
    expect(summary.payouts.single.accountLabel, upi.vpa);
  });

  test('statement: a completed visit with fee and TDS, then the payout', () {
    final s = Statement.fromJson(fixture('statement') as Json);
    expect(s.balancePaise, s.earnedPaise - s.paidOutPaise);
    final visit = s.items.firstWhere((l) => l.kind == 'BOOKING_EARNED');
    expect(visit.salePaise! - visit.feePaise - visit.tcsPaise - visit.tdsPaise, visit.amountPaise);
    expect(visit.tcsPaise, 0); // not GST-registered
    expect(visit.tdsPaise, greaterThan(0));
    expect(s.items.firstWhere((l) => l.kind == 'PAYOUT_APPROVED').salePaise, isNull);
    final paid = PayoutSummary.fromJson(fixture('payouts') as Json).payouts.single;
    expect(paid.amountPaise, visit.amountPaise);
    expect(paid.status, 'PROCESSED');
  });

  test('a bill of supply to the customer, with a download link', () {
    final inv = Invoice.fromJson((fixture('invoices') as List).single as Json);
    expect(inv.title, 'BILL_OF_SUPPLY'); // the partner isn't GST-registered
    expect(inv.recipientName, 'Ravi Kumar');
    expect(InvoiceLink.fromJson(fixture('invoice_link') as Json).path, startsWith('/invoices/${inv.id}/file?'));
  });

  test('terms to accept: the current version, rendered from Markdown', () {
    final d = LegalDoc.fromJson(fixture('legal_doc') as Json);
    expect(d.version, greaterThan(0));
    expect(d.body, isNot(contains('{{')));
    final blocks = parseLegalMarkdown(d.body);
    expect(blocks.first.kind, 'heading');
    expect(blocks.any((b) => b.kind == 'list'), isTrue);
  });
}
