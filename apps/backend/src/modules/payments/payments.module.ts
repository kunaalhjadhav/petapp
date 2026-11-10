import { Global, Module } from '@nestjs/common';
import { PaymentProviderModule } from '../../providers/payments/payment-provider.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Global()
@Module({
  imports: [PaymentProviderModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
