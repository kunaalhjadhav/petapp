import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_partner/common/money_text.dart';

/// The same checks as the API (finance.rules.ts), so mistakes are caught before the bank is asked.
void main() {
  test('IFSC: 11 characters, fifth is 0; spaces and case are forgiven', () {
    expect(ifscError('HDFC0001234'), isNull);
    expect(ifscError(' hdfc 000 1234 '), isNull);
    expect(cleanIfsc(' hdfc 000 1234 '), 'HDFC0001234');
    expect(ifscError('HDFC1001234'), isNotNull);
    expect(ifscError('HDFC000123'), isNotNull);
    expect(ifscError(''), isNotNull);
  });

  test('account numbers: 9 to 18 digits, typed twice the same', () {
    expect(accountNumberError('50100123456789'), isNull);
    expect(accountNumberError('5010 0123 4567 89'), isNull);
    expect(cleanAccountNumber('5010-0123 456789'), '50100123456789');
    expect(accountNumberError('12345678'), isNotNull);
    expect(accountNumberError('1234567890123456789'), isNotNull);
    expect(accountNumberError('50100ABC56789'), isNotNull);
    expect(confirmAccountError('5010 0123 456789', '50100123456789'), isNull);
    expect(confirmAccountError('50100123456789', '50100123456788'), isNotNull);
  });

  test('UPI IDs and names', () {
    expect(vpaError('meera@okhdfcbank'), isNull);
    expect(vpaError('meera.shah-1@ybl'), isNull);
    expect(vpaError('meera'), isNotNull);
    expect(vpaError('meera@ok1'), isNotNull);
    expect(holderNameError(' M '), isNotNull);
    expect(holderNameError('Meera Shah'), isNull);
  });

  test('statuses and statement lines in plain words', () {
    expect(payoutStatusText('PROCESSED'), 'Paid');
    expect(payoutStatusText('QUEUED'), 'On its way');
    expect(payoutStatusText('PROCESSING'), 'On its way');
    expect(payoutStatusText('REVERSED'), contains('back on your balance'));
    expect(statementKindText('PARCEL_DELIVERED'), 'Parcel delivered');
    expect(statementKindText('PAYOUT_APPROVED'), 'Payout to your account');
    expect(statementKindText('SOMETHING_NEW'), 'Something new');
    expect(invoiceKindText('CUSTOMER', 'TAX_INVOICE'), 'Tax invoice');
    expect(invoiceKindText('CUSTOMER', 'BILL_OF_SUPPLY'), 'Bill of supply');
    expect(invoiceKindText('CREDIT_NOTE', 'TAX_INVOICE'), 'Credit note');
    expect(accountStatusText('FAILED'), contains('refused'));
  });
}
