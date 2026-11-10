import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/common/money_text.dart';

import 'fixture.dart';

/// Refunds, invoices and prize money parse responses recorded from the real API (scripts/record_money_fixtures.py).
void main() {
  test('refunds say what they were for, where they are, and lead back to the order or booking', () {
    final refunds = (fixture('me_refunds') as List).cast<Json>().map(RefundItem.fromJson).toList();
    expect(refunds, hasLength(2));
    final booking = refunds.firstWhere((r) => r.aboutKind == 'BOOKING');
    expect(booking.status, 'PROCESSED');
    expect(booking.reason, 'BOOKING_CANCELLED');
    expect(booking.aboutTitle, startsWith('Full groom'));
    expect(booking.route, '/booking/${booking.aboutId}');
    expect(booking.reference, startsWith('fake_rfnd_'));
    expect(booking.processedAt, isNotNull);
    final parcel = refunds.firstWhere((r) => r.aboutKind == 'ORDER');
    expect(parcel.aboutTitle, startsWith('Order PO-'));
    expect(parcel.route, '/order/${parcel.aboutId}');
    expect(parcel.amountPaise, lessThanOrEqualTo(parcel.paidPaise));
    expect(refundStatusText(parcel.status), 'Refunded');
    expect(refundReasonText(parcel.reason), 'Parcel cancelled');
  });

  test('refund wording for each status', () {
    expect(refundStatusText('PENDING'), 'On its way');
    expect(refundStatusText('PROCESSING'), 'On its way');
    expect(refundStatusText('FAILED'), contains('our team'));
    expect(refundStatusText('SETTLED_MANUALLY'), contains('bank transfer'));
    for (final s in ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SETTLED_MANUALLY']) {
      expect(refundHelpText(s), isNotEmpty);
    }
    expect(refundReasonText('SOMETHING_NEW'), 'Refund');
  });

  test('invoices from a seller and a partner, newest first, with a download link', () {
    final invoices = (fixture('me_invoices') as List).cast<Json>().map(Invoice.fromJson).toList();
    expect(invoices.map((i) => i.title), ['BILL_OF_SUPPLY', 'TAX_INVOICE']);
    expect(invoices.every((i) => i.recipientName == 'Ravi Kumar'), isTrue);
    expect(invoiceKindText(invoices.first.kind, invoices.first.title), 'Bill of supply');
    final link = InvoiceLink.fromJson(fixture('invoice_link') as Json);
    expect(link.path, startsWith('/invoices/${invoices.first.id}/file?expires='));
    expect(link.path, contains('&sig='));
  });

  test('prize money: nothing owed, then a ₹15,000 prize less TDS, then paid to a UPI ID', () {
    final none = PayoutSummary.fromJson(fixture('me_payouts_none') as Json);
    expect(none.balancePaise, 0);
    expect(none.accountLabel, isNull);
    expect(PayoutAccounts.fromJson(fixture('me_payout_account_none') as Json).active, isNull);
    final due = PayoutSummary.fromJson(fixture('me_payouts_due') as Json);
    expect(due.balancePaise, 1050000); // ₹15,000 less 30% TDS
    expect(due.availablePaise, 1050000); // prizes have no holding period
    final account = PayoutAccounts.fromJson(fixture('me_payout_account_verified') as Json).active!;
    expect(account.method, 'UPI');
    expect(account.nameMatches, isTrue);
    expect(due.accountLabel, account.vpa);
    final paid = PayoutSummary.fromJson(fixture('me_payouts') as Json);
    expect(paid.balancePaise, 0);
    expect(paid.payouts.single.purpose, 'PRIZE');
    expect(paid.payouts.single.amountPaise, 1050000);
    expect(payoutStatusText(paid.payouts.single.status), 'Paid');
    final st = Statement.fromJson(fixture('me_statement') as Json);
    final prize = st.items.firstWhere((l) => l.kind == 'PRIZE_APPROVED');
    expect(prize.salePaise, 1500000);
    expect(prize.tdsPaise, 450000);
    expect(prize.amountPaise, 1050000);
    expect(prize.memo, contains('Winner'));
    expect(st.tdsPaise, 450000);
    expect(st.paidOutPaise, 1050000);
  });

  test('dates in India-style short form', () {
    final t = DateTime(2026, 10, 9, 21, 5);
    expect(shortDate(t, DateTime(2026, 1, 1)), '9 Oct');
    expect(shortDate(t, DateTime(2027, 1, 1)), '9 Oct 2026');
    expect(dateTime(t, DateTime(2026, 1, 1)), '9 Oct, 9:05 pm');
    expect(dateTime(DateTime(2026, 10, 9, 0, 30), DateTime(2026, 1, 1)), '9 Oct, 12:30 am');
  });
}
