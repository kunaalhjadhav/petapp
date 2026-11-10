import { Global, Module } from '@nestjs/common';
import { PaymentProviderModule } from '../../providers/payments/payment-provider.module';
import { PayoutProviderModule } from '../../providers/payouts/payout-provider.module';
import { PayoutAccountsService } from './payout-accounts.service';
import { PayoutsService } from './payouts.service';
import { SettlementsService } from './settlements.service';
import { InvoicesService } from './invoices.service';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { RefundExecutor } from './refund-executor.service';

/**
 * Money plumbing shared by the API and the worker: the ledger, postings for business events,
 * and refund execution. Global so any module can post inside its own database transaction.
 */
@Global()
@Module({
  imports: [PaymentProviderModule, PayoutProviderModule],
  providers: [LedgerService, FinanceService, RefundExecutor, PayoutAccountsService, PayoutsService, SettlementsService, InvoicesService],
  exports: [LedgerService, FinanceService, RefundExecutor, PayoutAccountsService, PayoutsService, SettlementsService, InvoicesService],
})
export class FinanceCoreModule {}
