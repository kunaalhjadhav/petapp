import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { FinanceReportsService } from './finance-reports.service';
import { ReconciliationService } from './reconciliation.service';
import { RefundExecutor } from './refund-executor.service';
import { AccountsQuery, EntriesQuery, IssuesQuery, PeriodQuery, RefundsQuery, ResolveIssueDto, SettleRefundDto, StatementQuery, TaxReportQuery, TrialBalanceQuery } from './finance.dto';

@ApiTags('Admin · Finance')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(
    private readonly reports: FinanceReportsService,
    private readonly recon: ReconciliationService,
    private readonly refunds: RefundExecutor,
    private readonly payments: PaymentsService,
  ) {}

  @Get('overview') @RequirePermissions(PERMISSIONS.FINANCE_READ) overview(@Query() q: PeriodQuery) {
    return this.reports.overview(q);
  }

  @Get('trial-balance') @RequirePermissions(PERMISSIONS.FINANCE_READ) trialBalance(@Query() q: TrialBalanceQuery) {
    return this.reports.trialBalance(q.asOf);
  }

  @Get('accounts') @RequirePermissions(PERMISSIONS.FINANCE_READ) accounts(@Query() q: AccountsQuery) {
    return this.reports.accounts(q);
  }

  @Get('accounts/:code/entries') @RequirePermissions(PERMISSIONS.FINANCE_READ) entries(@Param('code') code: string, @Query() q: EntriesQuery) {
    return this.reports.entries(code, q);
  }

  @Get('transactions/:id') @RequirePermissions(PERMISSIONS.FINANCE_READ) transaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.transaction(id);
  }

  @Get('refunds') @RequirePermissions(PERMISSIONS.FINANCE_READ) refundList(@Query() q: RefundsQuery) {
    return this.reports.refunds(q);
  }

  /** A FAILED refund goes back in the queue with fresh attempts. */
  @Post('refunds/:id/retry') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  async retry(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.refunds.retry(me.userId, id))) throw new NotFoundException('Only a failed refund can be retried.');
    return { id, status: 'PENDING' };
  }

  /** The customer was paid another way (e.g. bank transfer) after the gateway couldn't refund them. */
  @Post('refunds/:id/settle-manually') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  settle(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleRefundDto) {
    return this.refunds.settleManually(me.userId, id, dto.reference);
  }

  @Get('reconciliation/runs') @RequirePermissions(PERMISSIONS.FINANCE_READ) runs() {
    return this.reports.runs();
  }

  /** Runs a reconciliation now (it also runs every night). */
  @Post('reconciliation/run') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE) run(@CurrentUser() me: Principal) {
    return this.recon.run('MANUAL', me.userId);
  }

  @Get('reconciliation/issues') @RequirePermissions(PERMISSIONS.FINANCE_READ) issues(@Query() q: IssuesQuery) {
    return this.reports.issues(q);
  }

  @Post('reconciliation/issues/:id/resolve') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  resolve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveIssueDto) {
    return this.reports.resolveIssue(me.userId, id, dto.resolution);
  }

  /** A capture the gateway made that we never heard about: confirmed with the gateway, then completed as usual. */
  @Post('payments/:id/recover') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  recover(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.recover(me.userId, id);
  }

  @Get('tax-report') @RequirePermissions(PERMISSIONS.FINANCE_READ) taxReport(@Query() q: TaxReportQuery) {
    return this.reports.taxReport(q);
  }
}

/** Sellers and partners see their own account: what they're owed, line by line. */
@ApiTags('Payee statements')
@ApiBearerAuth()
@Controller()
export class StatementController {
  constructor(
    private readonly reports: FinanceReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @RequireFeature('ENABLE_MARKETPLACE')
  @Get('vendor/statement')
  async vendor(@CurrentUser() me: Principal, @Query() q: StatementQuery) {
    const v = await this.prisma.vendor.findUnique({ where: { userId: me.userId }, select: { id: true } });
    if (!v) throw new NotFoundException('Set up your store first.');
    return this.reports.statement('VENDOR', v.id, q);
  }

  /** Prize winners: prizes owed (after TDS) and what has been paid out. */
  @Get('me/statement')
  mine(@CurrentUser() me: Principal, @Query() q: StatementQuery) {
    return this.reports.statement('USER', me.userId, q);
  }

  /** The signed-in customer's refunds, and where each one is. */
  @Get('me/refunds')
  refunds(@CurrentUser() me: Principal, @Query() q: StatementQuery) {
    return this.reports.customerRefunds(me.userId, q);
  }

  @RequireFeature('ENABLE_SERVICES')
  @Get('partner/statement')
  async partner(@CurrentUser() me: Principal, @Query() q: StatementQuery) {
    const p = await this.prisma.servicePartner.findUnique({ where: { userId: me.userId }, select: { id: true } });
    if (!p) throw new NotFoundException('Set up your business first.');
    return this.reports.statement('PARTNER', p.id, q);
  }
}
