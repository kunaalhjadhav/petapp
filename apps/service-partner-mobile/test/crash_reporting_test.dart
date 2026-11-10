import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_partner/services/crash_reporting.dart';

/// Crash reports never carry phone numbers, emails or sign-in tokens.
void main() {
  test('masks personal data and tokens', () {
    expect(scrubText('OTP failed for +91 98123 45678'), 'OTP failed for [phone]');
    expect(scrubText('call 9812345678 now'), 'call [phone] now');
    expect(scrubText('owner asha.k@example.in'), 'owner [email]');
    expect(scrubText('Authorization: Bearer abc.def-ghi_123'), 'Authorization: Bearer [token]');
    expect(scrubText('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature-x'), 'token [token]');
  });

  test('leaves ordinary text alone', () {
    expect(scrubText('Order PA-2026-000123 failed: 503'), 'Order PA-2026-000123 failed: 503');
    expect(scrubText('price 49900 paise'), 'price 49900 paise');
  });
}
