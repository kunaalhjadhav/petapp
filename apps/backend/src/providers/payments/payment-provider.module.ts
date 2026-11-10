import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { FakePaymentProvider, PAYMENT_PROVIDER, RazorpayProvider, type PaymentProvider } from './payment.provider';

/** The payment gateway, shared by the API (checkout, webhooks) and the worker (refunds, reconciliation). */
@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): PaymentProvider =>
        c.get('PAYMENT_PROVIDER') === 'razorpay'
          ? new RazorpayProvider(c.get('RAZORPAY_KEY_ID')!, c.get('RAZORPAY_KEY_SECRET')!, c.get('RAZORPAY_WEBHOOK_SECRET')!)
          : new FakePaymentProvider(),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
