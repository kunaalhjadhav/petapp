import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/offline_logic.dart';
import '../api/petapp_api.dart';

/// Thrown when the gateway took the payment but the API couldn't be told yet (no connection). The app keeps trying.
class PaymentPending implements UserFacingError {
  PaymentPending([this.message = 'Payment verification is pending. We’ll confirm it as soon as you’re back online. You won’t be charged twice.']);
  @override
  final String message;
  @override
  String toString() => message;
}

/// Payments waiting to be confirmed with the API (spec §85: "payment success but API failure").
class PendingPayments {
  static const _key = 'payments:pending';

  static Future<List<Map<String, dynamic>>> _all(SharedPreferences p) async {
    final raw = p.getString(_key);
    if (raw == null) return [];
    try {
      return (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    } catch (_) {
      return [];
    }
  }

  static Future<void> add(String paymentId, String providerPaymentId, String signature) async {
    final p = await SharedPreferences.getInstance();
    final all = (await _all(p))..removeWhere((x) => x['paymentId'] == paymentId);
    all.add({'paymentId': paymentId, 'providerPaymentId': providerPaymentId, 'signature': signature, 'at': DateTime.now().toIso8601String()});
    await p.setString(_key, jsonEncode(all));
  }

  /// Tries each waiting payment again. Returns how many were confirmed.
  static Future<int> retry(PetAppApi api) async {
    final p = await SharedPreferences.getInstance();
    final all = await _all(p);
    if (all.isEmpty) return 0;
    final left = <Map<String, dynamic>>[];
    var confirmed = 0;
    for (final x in all) {
      final at = DateTime.tryParse('${x['at']}') ?? DateTime.now();
      if (pendingPaymentExpired(at, DateTime.now())) continue;
      try {
        await api.verifyPayment('${x['paymentId']}', '${x['providerPaymentId']}', '${x['signature']}');
        confirmed++;
      } on ApiException catch (e) {
        // Still offline or the server is struggling: keep it. A refusal (bad signature, not found) is final.
        if (e.status == 0 || e.status >= 500 || e.status == 408 || e.status == 429) left.add(x);
      }
    }
    await p.setString(_key, jsonEncode(left));
    return confirmed;
  }

  static Future<void> clear() async => (await SharedPreferences.getInstance()).remove(_key);
}
