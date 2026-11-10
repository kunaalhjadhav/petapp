import { Module } from '@nestjs/common';
import { AdminFinanceController, StatementController } from './finance.controller';
import { FinanceReportsService } from './finance-reports.service';
import { ReconciliationService } from './reconciliation.service';
import { AdminPayoutsController, PayeePayoutsController, PayoutWebhookController } from './payouts.controller';
import { PrizesService } from './prizes.service';
import { AdminInvoicesController, InvoicesController } from './invoices.controller';

/** Finance screens and reports for staff, and statements for sellers and partners. */
@Module({
  controllers: [AdminFinanceController, StatementController, PayeePayoutsController, AdminPayoutsController, PayoutWebhookController, InvoicesController, AdminInvoicesController],
  providers: [FinanceReportsService, ReconciliationService, PrizesService],
})
export class FinanceModule {}
