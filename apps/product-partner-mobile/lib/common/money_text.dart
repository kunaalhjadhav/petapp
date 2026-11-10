// Plain-language text and input checks for the money screens. Pure Dart (no Flutter), unit-tested.
// The checks mirror the API's (finance.rules.ts) so mistakes are caught before the bank is asked.

/// Payout status as the seller sees it.
String payoutStatusText(String status) => switch (status) {
      'PROCESSED' => 'Paid',
      'QUEUED' || 'PROCESSING' => 'On its way',
      'FAILED' => 'Not paid: back on your balance',
      'REVERSED' => 'Returned by the bank: back on your balance',
      'DRAFT' => 'Being prepared',
      'CANCELLED' => 'Not sent',
      _ => status,
    };

/// A ledger posting on the seller's statement.
String statementKindText(String kind) => switch (kind) {
      'PARCEL_DELIVERED' => 'Parcel delivered',
      'PARCEL_RETURNED' => 'Parcel returned',
      'BOOKING_EARNED' => 'Visit completed',
      'PRIZE_APPROVED' => 'Prize',
      'PAYOUT_APPROVED' => 'Payout to your account',
      'PAYOUT_FAILED' => 'Payout not paid: money back',
      'PAYOUT_REVERSED' => 'Payout returned by the bank: money back',
      _ => kind.isEmpty ? kind : kind[0] + kind.substring(1).toLowerCase().replaceAll('_', ' '),
    };

String invoiceKindText(String kind, String title) => switch (kind) {
      'CREDIT_NOTE' => 'Credit note',
      'COMMISSION' => 'PetApp fee invoice',
      _ => title == 'BILL_OF_SUPPLY' ? 'Bill of supply' : 'Tax invoice',
    };

/// Account status line for the payout account screen.
String accountStatusText(String status) => switch (status) {
      'VERIFIED' => 'Verified with your bank',
      'PENDING' => 'Being checked with your bank',
      'FAILED' => 'Your bank refused this account',
      'DISABLED' => 'Switched off',
      _ => status,
    };

final _ifsc = RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$');
final _account = RegExp(r'^\d{9,18}$');
final _vpa = RegExp(r'^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$');

/// Upper-cased, without spaces: what is sent to the API.
String cleanIfsc(String s) => s.replaceAll(RegExp(r'\s'), '').toUpperCase();
String cleanAccountNumber(String s) => s.replaceAll(RegExp(r'[\s-]'), '');

String? holderNameError(String s) => s.trim().length < 2 ? 'Enter the name exactly as your bank has it.' : null;
String? ifscError(String s) => _ifsc.hasMatch(cleanIfsc(s)) ? null : 'IFSC is 11 characters, like HDFC0001234 (on your cheque book or passbook).';
String? accountNumberError(String s) => _account.hasMatch(cleanAccountNumber(s)) ? null : 'Account number is 9 to 18 digits.';
String? confirmAccountError(String first, String again) => cleanAccountNumber(first) == cleanAccountNumber(again) ? null : 'The account numbers don’t match.';
String? vpaError(String s) => _vpa.hasMatch(s.trim()) ? null : 'Enter a UPI ID like name@bank.';
