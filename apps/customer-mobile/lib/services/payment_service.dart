import 'dart:async';

import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../api/petapp_api.dart';
import 'pending_payments.dart';

export 'pending_payments.dart' show PaymentPending;

/// Thrown when the user closes the checkout or the gateway declines.
class PaymentCancelled implements UserFacingError {
  PaymentCancelled(this.message);
  @override
  final String message;
  @override
  String toString() => message;
}

/// Opens the gateway checkout, then has the API verify the result. The app never decides
/// on its own that a payment succeeded: only the server's signature check does.
class PaymentService {
  PaymentService(this._api);
  final PetAppApi _api;

  Future<void> pay(Checkout c, {required String description}) async {
    if (c.provider == 'fake') {
      // Development API: no gateway, the API completes it.
      await _api.simulatePayment(c.paymentId);
      return;
    }
    final razorpay = Razorpay();
    final done = Completer<PaymentSuccessResponse>();
    razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) => done.isCompleted ? null : done.complete(r));
    razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) {
      if (!done.isCompleted) done.completeError(PaymentCancelled(r.message?.isNotEmpty == true ? r.message! : 'Payment wasn’t completed.'));
    });
    razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse r) {
      if (!done.isCompleted) done.completeError(PaymentCancelled('Finish the payment in ${r.walletName ?? 'your wallet'}, then refresh.'));
    });
    try {
      razorpay.open({'key': c.key, 'amount': c.amountPaise, 'currency': 'INR', 'order_id': c.orderId, 'name': 'PetApp', 'description': description});
      final r = await done.future;
      try {
        await _api.verifyPayment(c.paymentId, r.paymentId ?? '', r.signature ?? '');
      } on ApiException catch (e) {
        // The gateway took the money but the API didn't hear back: keep it and confirm later, never ask to pay again.
        if (e.status == 0 || e.status >= 500 || e.status == 408) {
          await PendingPayments.add(c.paymentId, r.paymentId ?? '', r.signature ?? '');
          throw PaymentPending();
        }
        rethrow;
      }
    } finally {
      razorpay.clear();
    }
  }
}
