import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { FakePayoutProvider, PAYOUT_PROVIDER, RazorpayXProvider, type PayoutProvider } from './payout.provider';

/** Where payouts go out: RazorpayX in staging/production, a fake for development and tests. */
@Global()
@Module({
  providers: [
    {
      provide: PAYOUT_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): PayoutProvider =>
        c.get('PAYOUT_PROVIDER') === 'razorpayx'
          ? new RazorpayXProvider(c.get('RAZORPAYX_KEY_ID')!, c.get('RAZORPAYX_KEY_SECRET')!, c.get('RAZORPAYX_ACCOUNT_NUMBER')!, c.get('RAZORPAYX_WEBHOOK_SECRET')!)
          : new FakePayoutProvider(),
    },
  ],
  exports: [PAYOUT_PROVIDER],
})
export class PayoutProviderModule {}
