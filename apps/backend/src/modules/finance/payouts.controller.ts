import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import type { Request } from 'express';
import { AdminOnly, CurrentUser, Public, RequireFeature, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { Paged } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYOUT_PROVIDER, type PayoutProvider } from '../../providers/payouts/payout.provider';
import { PayoutAccountsService } from './payout-accounts.service';
import { PayoutsService } from './payouts.service';
import { PrizesService } from './prizes.service';
import { SettlementsService } from './settlements.service';
import { AddPayoutAccountDto, BatchesQuery, CreateBatchDto, DisableAccountDto, PayeeTypeQuery, PayoutAccountsQuery, PrizesQuery } from './payouts.dto';
import type { PayeeType } from './finance.rules';

const ACCOUNT_CHANGE = { default: { limit: 5, ttl: 3_600_000 } };

/** Who the signed-in user is paid as: their store, their service business, or themselves (prizes). */
async function payee(prisma: PrismaService, as: PayeeType, userId: string): Promise<{ id: string; name: string }> {
  if (as === 'VENDOR') {
    const v = await prisma.vendor.findUnique({ where: { userId }, select: { id: true, businessName: true } });
    if (!v) throw new NotFoundException('Set up your store first.');
    return { id: v.id, name: v.businessName };
  }
  if (as === 'PARTNER') {
    const p = await prisma.servicePartner.findUnique({ where: { userId }, select: { id: true, businessName: true } });
    if (!p) throw new NotFoundException('Set up your business first.');
    return { id: p.id, name: p.businessName };
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true } });
  return { id: u.id, name: u.name ?? 'PetApp user' };
}

@ApiTags('Payouts (payees)')
@ApiBearerAuth()
@Controller()
export class PayeePayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly accounts: PayoutAccountsService,
  ) {}

  private async summary(as: PayeeType, userId: string) {
    const p = await payee(this.prisma, as, userId);
    return this.payouts.summary(as, p.id);
  }
  private async account(as: PayeeType, userId: string) {
    const p = await payee(this.prisma, as, userId);
    return this.accounts.mine(as, p.id);
  }
  private async add(as: PayeeType, userId: string, dto: AddPayoutAccountDto) {
    const p = await payee(this.prisma, as, userId);
    return this.accounts.add(as, p.id, p.name, userId, dto);
  }

  @RequireFeature('ENABLE_MARKETPLACE') @Get('vendor/payouts') vendorPayouts(@CurrentUser() me: Principal) {
    return this.summary('VENDOR', me.userId);
  }
  @RequireFeature('ENABLE_MARKETPLACE') @Get('vendor/payout-account') vendorAccount(@CurrentUser() me: Principal) {
    return this.account('VENDOR', me.userId);
  }
  @RequireFeature('ENABLE_MARKETPLACE') @Throttle(ACCOUNT_CHANGE) @Post('vendor/payout-account') addVendorAccount(@CurrentUser() me: Principal, @Body() dto: AddPayoutAccountDto) {
    return this.add('VENDOR', me.userId, dto);
  }

  @RequireFeature('ENABLE_SERVICES') @Get('partner/payouts') partnerPayouts(@CurrentUser() me: Principal) {
    return this.summary('PARTNER', me.userId);
  }
  @RequireFeature('ENABLE_SERVICES') @Get('partner/payout-account') partnerAccount(@CurrentUser() me: Principal) {
    return this.account('PARTNER', me.userId);
  }
  @RequireFeature('ENABLE_SERVICES') @Throttle(ACCOUNT_CHANGE) @Post('partner/payout-account') addPartnerAccount(@CurrentUser() me: Principal, @Body() dto: AddPayoutAccountDto) {
    return this.add('PARTNER', me.userId, dto);
  }

  /** Prize winners. */
  @Get('me/payouts') myPayouts(@CurrentUser() me: Principal) {
    return this.summary('USER', me.userId);
  }
  @Get('me/payout-account') myAccount(@CurrentUser() me: Principal) {
    return this.account('USER', me.userId);
  }
  @Throttle(ACCOUNT_CHANGE) @Post('me/payout-account') addMyAccount(@CurrentUser() me: Principal, @Body() dto: AddPayoutAccountDto) {
    return this.add('USER', me.userId, dto);
  }
}

@ApiTags('Admin · Finance')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/finance')
export class AdminPayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly accounts: PayoutAccountsService,
    private readonly prizes: PrizesService,
    private readonly settlements: SettlementsService,
  ) {}

  /** Who would be paid, and how much, if a batch were prepared now. */
  @Get('payouts/preview') @RequirePermissions(PERMISSIONS.FINANCE_READ) preview(@Query() q: PayeeTypeQuery) {
    return this.payouts.preview(q.payeeType);
  }

  @Post('payout-batches') @RequirePermissions(PERMISSIONS.FINANCE_MANAGE) create(@CurrentUser() me: Principal, @Body() dto: CreateBatchDto) {
    return this.payouts.createBatch(me.userId, dto.payeeType, dto.note);
  }

  @Get('payout-batches') @RequirePermissions(PERMISSIONS.FINANCE_READ) async list(@Query() q: BatchesQuery) {
    const { items, total } = await this.payouts.batches(q);
    return Paged.of(items, total, q);
  }

  @Get('payout-batches/:id') @RequirePermissions(PERMISSIONS.FINANCE_READ) one(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.batch(id);
  }

  /** Must be someone other than the person who prepared the batch. */
  @Post('payout-batches/:id/approve') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE) approve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.approve(me.userId, id);
  }

  @Post('payout-batches/:id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE) cancel(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.cancel(me.userId, id);
  }

  @Get('payout-accounts') @RequirePermissions(PERMISSIONS.FINANCE_READ) async payoutAccounts(@Query() q: PayoutAccountsQuery) {
    const where = { status: q.status, ownerType: q.ownerType };
    const [rows, total] = await Promise.all([
      this.prisma.payoutAccount.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: q.skip, take: q.limit }),
      this.prisma.payoutAccount.count({ where }),
    ]);
    const items = await Promise.all(
      rows.map(async (a) => {
        const names = await this.accounts.ownerNames(a.ownerType as PayeeType, a.ownerId).catch(() => [] as string[]);
        return { ...this.accounts.view(a, names), ownerType: a.ownerType, ownerId: a.ownerId, ownerName: names[0] ?? null };
      }),
    );
    return Paged.of(items, total, q);
  }

  @Post('payout-accounts/:id/disable') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  disable(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisableAccountDto) {
    return this.accounts.disable(me.userId, id, dto.reason);
  }

  @Get('prizes') @RequirePermissions(PERMISSIONS.FINANCE_READ) prizeList(@Query() q: PrizesQuery) {
    return this.prizes.list(q.status);
  }

  @Post('prizes/:id/approve') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE) approvePrize(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.prizes.approve(me.userId, id);
  }

  @Get('settlements') @RequirePermissions(PERMISSIONS.FINANCE_READ) settlementList() {
    return this.settlements.list();
  }

  /** Fetches the gateway's recent transfers to the bank and books new ones (also runs nightly). */
  @Post('settlements/sync') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE) async sync() {
    return { added: await this.settlements.sync(30) };
  }
}

/** RazorpayX webhooks: payout.* and fund_account.validation.* events. Signature-checked and idempotent. */
@ApiTags('Payouts (payees)')
@Controller()
export class PayoutWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly accounts: PayoutAccountsService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  @Public()
  @Post('webhooks/payouts')
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    if (!req.rawBody) throw new BadRequestException('Missing body.');
    const event = this.provider.parseWebhook(req.rawBody, headers);
    if (!event) throw new BadRequestException('Invalid signature.');
    const key = { provider_eventId: { provider: `${this.provider.name}-payouts`, eventId: event.eventId } };
    const seen = await this.prisma.paymentWebhookEvent.findUnique({ where: key });
    if (seen?.processedAt) return { status: 'duplicate' };
    if (!seen) {
      await this.prisma.paymentWebhookEvent
        .create({ data: { provider: `${this.provider.name}-payouts`, eventId: event.eventId, type: event.kind, payload: JSON.parse(req.rawBody.toString('utf8')) } })
        .catch((e: { code?: string }) => { if (e.code !== 'P2002') throw e; });
    }
    let status = event.kind as string;
    if (event.kind === 'payout') status = `payout:${await this.payouts.fromWebhook(event.payout)}`;
    if (event.kind === 'validation') {
      const a = await this.prisma.payoutAccount.findFirst({ where: { providerValidationId: event.validation.validationId } });
      status = `validation:${a ? await this.accounts.applyValidation(a.id, event.validation) : 'unknown'}`;
    }
    await this.prisma.paymentWebhookEvent.update({ where: key, data: { processedAt: new Date() } });
    return { status };
  }
}
