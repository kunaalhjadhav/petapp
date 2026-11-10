import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, Public, RequirePermissions } from '../../common/decorators/auth.decorators';
import { AppConfig } from '../../config/app-config.service';
import type { Principal } from '../../common/principal';
import { Paged, PaginationQuery } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoicesService } from './invoices.service';
import { renderInvoicePdf } from './invoice-pdf';
import { invoiceLink, invoiceLinkKey, verifyInvoiceLink } from './invoice.rules';
import type { Invoice } from '../../generated/prisma/client';

class InvoicesQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['CUSTOMER', 'COMMISSION', 'CREDIT_NOTE'] }) @IsOptional() @IsIn(['CUSTOMER', 'COMMISSION', 'CREDIT_NOTE']) kind?: Invoice['kind'];
}
class CommissionRunDto {
  @ApiProperty({ example: '2026-09', description: 'A finished month (India time)' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Use a month like 2026-09' }) month: string;
}

const pdf = async (i: Invoice) =>
  new StreamableFile(await renderInvoicePdf(i), { type: 'application/pdf', disposition: `inline; filename="${i.number.replace(/\//g, '-')}.pdf"` });

/** Invoices for the people they're about: the customer, and the seller or partner who issued (or received) them. */
@ApiTags('Invoices')
@ApiBearerAuth()
@Controller()
export class InvoicesController {
  private readonly linkKey: string;

  constructor(
    private readonly invoices: InvoicesService,
    private readonly prisma: PrismaService,
    config: AppConfig,
  ) {
    this.linkKey = invoiceLinkKey(config.get('JWT_ACCESS_SECRET'));
  }

  private async payeeKeys(userId: string) {
    const [v, p] = await Promise.all([
      this.prisma.vendor.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.servicePartner.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    return [v && `VENDOR:${v.id}`, p && `PARTNER:${p.id}`].filter((x): x is string => !!x);
  }

  /** The customer's invoices and credit notes (from sellers and partners). */
  @Get('me/invoices') async mine(@CurrentUser() me: Principal, @Query() q: InvoicesQuery) {
    const [items, total] = await this.invoices.list({ customerId: me.userId, kind: q.kind }, q);
    return Paged.of(items, total, q);
  }

  /** A seller's invoices: issued in their name to customers, and PetApp's commission invoices to them. */
  @Get('vendor/invoices') async vendor(@CurrentUser() me: Principal, @Query() q: InvoicesQuery) {
    const v = await this.prisma.vendor.findUnique({ where: { userId: me.userId }, select: { id: true } });
    if (!v) throw new NotFoundException('Set up your store first.');
    const [items, total] = await this.invoices.list({ payeeKey: `VENDOR:${v.id}`, kind: q.kind }, q);
    return Paged.of(items, total, q);
  }

  @Get('partner/invoices') async partner(@CurrentUser() me: Principal, @Query() q: InvoicesQuery) {
    const p = await this.prisma.servicePartner.findUnique({ where: { userId: me.userId }, select: { id: true } });
    if (!p) throw new NotFoundException('Set up your business first.');
    const [items, total] = await this.invoices.list({ payeeKey: `PARTNER:${p.id}`, kind: q.kind }, q);
    return Paged.of(items, total, q);
  }

  /** The invoice if it's the user's (as customer, seller or partner); anyone else gets 404. */
  private async owned(userId: string, id: string) {
    const i = await this.invoices.get(id);
    const ok = i.customerId === userId || (i.payeeKey && (await this.payeeKeys(userId)).includes(i.payeeKey));
    if (!ok) throw new NotFoundException('Invoice not found.');
    return i;
  }

  /** The PDF, for its customer or its seller/partner; anyone else gets 404. */
  @ApiProduces('application/pdf')
  @Get('invoices/:id/pdf') async file(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return pdf(await this.owned(me.userId, id));
  }

  /**
   * A download link the apps can open in the phone's browser (which can't send the sign-in token).
   * Signed for this one invoice and valid for 5 minutes. `path` is under /api/v1.
   */
  @Post('invoices/:id/link') @HttpCode(200) async link(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const i = await this.owned(me.userId, id);
    return { ...invoiceLink(this.linkKey, i.id), fileName: `${i.number.replace(/\//g, '-')}.pdf` };
  }

  /** Opens a signed download link. An expired or altered link gets 404, like an invoice that doesn't exist. */
  @Public()
  @ApiProduces('application/pdf')
  @Get('invoices/:id/file') async linked(@Param('id', ParseUUIDPipe) id: string, @Query('expires') expires: unknown, @Query('sig') sig: unknown) {
    if (!verifyInvoiceLink(this.linkKey, id, expires, sig)) throw new NotFoundException('This download link has expired. Open the invoice again from the app.');
    return pdf(await this.invoices.get(id));
  }
}

@ApiTags('Admin · Finance')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/finance/invoices')
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get() @RequirePermissions(PERMISSIONS.FINANCE_READ) async list(@Query() q: InvoicesQuery) {
    const [items, total] = await this.invoices.list({ kind: q.kind }, q);
    return Paged.of(items, total, q);
  }

  @ApiProduces('application/pdf')
  @Get(':id/pdf') @RequirePermissions(PERMISSIONS.FINANCE_READ) async file(@Param('id', ParseUUIDPipe) id: string) {
    return pdf(await this.invoices.get(id));
  }

  /** Issues PetApp's commission invoices for a finished month. Safe to run again. */
  @Post('commission') @HttpCode(200) @RequirePermissions(PERMISSIONS.FINANCE_MANAGE) commission(@Body() dto: CommissionRunDto) {
    return this.invoices.commissionForMonth(dto.month);
  }
}
