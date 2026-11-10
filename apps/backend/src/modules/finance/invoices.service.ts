import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Invoice } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../platform/platform.service';
import { financialYear, invoiceNumber, parcelLines, prefixFrom, sameState, splitGst, totals, type InvoiceLine, type Party } from './invoice.rules';
import { gstWithin, type PayeeType } from './finance.rules';

type Tx = Prisma.TransactionClient;
const IST = 330 * 60_000;

/**
 * Tax invoices. Each is numbered from a gapless series (one per issuer and financial year) inside the same
 * database transaction as the sale, so a rolled-back sale never leaves a hole. Issued invoices can't change.
 *
 * - CUSTOMER: issued in the seller's (or partner's) name when a parcel is delivered or a visit completed.
 * - CREDIT_NOTE: issued in the seller's name when a returned parcel is refunded.
 * - COMMISSION: issued by PetApp to each seller and partner for the month's commission and fees.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
  ) {}

  private async next(tx: Tx, series: string): Promise<number> {
    const [row] = await tx.$queryRaw<Array<{ next: number }>>`
      INSERT INTO "InvoiceSequence" (series, next, "updatedAt") VALUES (${series}, 2, now())
      ON CONFLICT (series) DO UPDATE SET next = "InvoiceSequence".next + 1, "updatedAt" = now()
      RETURNING next - 1 AS next`;
    return Number(row.next);
  }

  private async issue(tx: Tx, x: {
    kind: Invoice['kind']; sourceKey: string; issuerKey: string; prefix: string; issuer: Party; recipient: Party & { [k: string]: unknown };
    placeOfSupply: string; lines: InvoiceLine[]; customerId?: string; payeeKey?: string; originalInvoiceId?: string; issuedAt?: Date;
  }): Promise<Invoice> {
    const existing = await tx.invoice.findUnique({ where: { kind_sourceKey: { kind: x.kind, sourceKey: x.sourceKey } } });
    if (existing) return existing;
    const issuedAt = x.issuedAt ?? new Date();
    const fy = financialYear(issuedAt);
    const series = `${x.kind}:${x.issuerKey}:${fy.long}`;
    const seq = await this.next(tx, series);
    const t = totals(x.lines);
    const title = x.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : x.issuer.gstin ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY';
    return tx.invoice.create({
      data: {
        kind: x.kind, title, series, seq, number: invoiceNumber(x.prefix, fy.short, seq),
        financialYear: fy.long, issuedAt, sourceKey: x.sourceKey,
        issuer: x.issuer as unknown as Prisma.InputJsonValue, recipient: x.recipient as unknown as Prisma.InputJsonValue,
        placeOfSupply: x.placeOfSupply, lines: x.lines as unknown as Prisma.InputJsonValue, ...t,
        customerId: x.customerId, payeeKey: x.payeeKey, originalInvoiceId: x.originalInvoiceId,
      },
    });
  }

  private vendorParty(v: { businessName: string; legalName: string | null; gstin: string | null; pan: string | null; addressLine: string; city: string; state: string; pincode: string }): Party {
    return { name: v.legalName || v.businessName, gstin: v.gstin, pan: v.pan, address: `${v.addressLine}, ${v.city} ${v.pincode}`, state: v.state };
  }

  /** The seller's invoice to the customer for a delivered parcel. */
  async forParcel(tx: Tx, subOrderId: string) {
    const s = await tx.subOrder.findUniqueOrThrow({ where: { id: subOrderId }, include: { items: true, vendor: true, order: { include: { user: { select: { name: true } } } } } });
    const ship = s.order.shipTo as { name?: string; line1?: string; line2?: string; locality?: string; city?: string; state?: string; pincode?: string };
    const intra = sameState(s.vendor.state, ship.state ?? '');
    const lines = parcelLines(
      s.items.map((i) => ({ description: `${i.productTitle} (${i.variantTitle}) · ${i.sku}`, qty: i.qty, unitPaise: i.unitPricePaise, lineTotalPaise: i.lineTotalPaise, rateBps: i.gstRateBps })),
      s.discountPaise, s.shippingPaise, !!s.vendor.gstin, intra,
    );
    return this.issue(tx, {
      kind: 'CUSTOMER', sourceKey: `SubOrder:${s.id}`, issuerKey: `VENDOR:${s.vendor.id}`, prefix: prefixFrom(s.vendor.businessName, 'I'),
      issuer: this.vendorParty(s.vendor),
      recipient: { name: ship.name || s.order.user.name || 'Customer', gstin: null, address: [ship.line1, ship.line2, ship.locality, ship.city, ship.pincode].filter(Boolean).join(', '), state: ship.state ?? '', orderCode: s.order.code, parcelCode: s.code },
      placeOfSupply: ship.state ?? s.vendor.state, lines, customerId: s.order.userId, payeeKey: `VENDOR:${s.vendor.id}`, issuedAt: s.deliveredAt ?? undefined,
    });
  }

  /** The seller's credit note when a returned parcel's items are refunded (shipping isn't refunded). */
  async forReturn(tx: Tx, returnId: string) {
    const r = await tx.returnRequest.findUniqueOrThrow({ where: { id: returnId }, include: { subOrder: { include: { items: true, vendor: true, order: { include: { user: { select: { name: true } } } } } } } });
    const s = r.subOrder;
    const original = (await tx.invoice.findUnique({ where: { kind_sourceKey: { kind: 'CUSTOMER', sourceKey: `SubOrder:${s.id}` } } })) ?? (await this.forParcel(tx, s.id));
    // The credit note mirrors the original invoice's item lines (shipping isn't refunded), so registration,
    // place of supply and rates are exactly what was charged.
    const lines = (original.lines as unknown as InvoiceLine[]).filter((l) => l.description !== 'Shipping charges').map((l) => ({ ...l, description: `Return: ${l.description}` }));
    return this.issue(tx, {
      kind: 'CREDIT_NOTE', sourceKey: `Return:${r.id}`, issuerKey: `VENDOR:${s.vendor.id}`, prefix: prefixFrom(s.vendor.businessName, 'C'),
      issuer: original.issuer as unknown as Party, recipient: { ...(original.recipient as unknown as Party), againstInvoice: original.number },
      placeOfSupply: original.placeOfSupply, lines, customerId: s.order.userId, payeeKey: `VENDOR:${s.vendor.id}`, originalInvoiceId: original.id,
    });
  }

  /** The partner's invoice to the customer for a completed visit (the service is supplied at the partner's location). */
  async forBooking(tx: Tx, bookingId: string) {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { partner: true, service: { select: { name: true } }, customer: { select: { name: true } } } });
    if (b.status !== 'COMPLETED') return null;
    const rate = await this.platform.getSetting<number>('finance.servicesGstRateBps');
    const registered = !!b.partner.gstin;
    const gst = registered ? gstWithin(b.pricePaise, rate) : 0;
    const addr = b.address as { line1?: string; city?: string; state?: string } | null;
    // At the partner's place the service is supplied there; a home visit is supplied where the customer is.
    const place = addr?.state || b.partner.state;
    const line: InvoiceLine = { description: `${b.service.name} (${b.code})`, hsnSac: null, qty: 1, unitPaise: b.pricePaise, taxablePaise: b.pricePaise - gst, rateBps: registered ? rate : 0, ...splitGst(gst, sameState(b.partner.state, place)), totalPaise: b.pricePaise };
    return this.issue(tx, {
      kind: 'CUSTOMER', sourceKey: `Booking:${b.id}`, issuerKey: `PARTNER:${b.partner.id}`, prefix: prefixFrom(b.partner.businessName, 'S'),
      issuer: { name: b.partner.businessName, gstin: b.partner.gstin, pan: b.partner.pan, address: `${b.partner.addressLine}, ${b.partner.city} ${b.partner.pincode}`, state: b.partner.state },
      recipient: { name: b.customer.name || 'Customer', gstin: null, address: addr ? [addr.line1, addr.city].filter(Boolean).join(', ') : '', state: addr?.state ?? b.partner.state, bookingCode: b.code },
      placeOfSupply: place, lines: [line], customerId: b.customerId, payeeKey: `PARTNER:${b.partner.id}`, issuedAt: b.completedAt ?? undefined,
    });
  }

  /**
   * PetApp's monthly invoices for commission and fees, one per seller and partner with fees that month.
   * Only for a finished month (India time). Idempotent: running it again issues only what's missing.
   */
  async commissionForMonth(month: string) {
    const [y, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1) - IST);
    const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - IST);
    if (end > new Date()) throw new BadRequestException('Commission invoices are issued once the month is over.');
    const s = {
      name: await this.platform.getSetting<string>('company.legalName'), gstin: await this.platform.getSetting<string>('company.gstin'),
      pan: await this.platform.getSetting<string>('company.pan'), address: await this.platform.getSetting<string>('company.address'),
      state: await this.platform.getSetting<string>('company.state'), sac: await this.platform.getSetting<string>('invoice.commissionSac'),
    };
    if (!s.name || !s.gstin || !s.address) throw new BadRequestException('Set PetApp’s company name, GSTIN and address in settings before issuing commission invoices.');
    const rows = await this.prisma.$queryRaw<Array<{ code: string; ownerType: string; ownerId: string; revenue: bigint; gst: bigint }>>`
      SELECT pa.code, pa."ownerType", pa."ownerId",
             SUM(CASE WHEN a.code = 'FEE_REVENUE' THEN e."creditPaise" - e."debitPaise" ELSE 0 END)::bigint AS revenue,
             SUM(CASE WHEN a.code = 'GST_PAYABLE' THEN e."creditPaise" - e."debitPaise" ELSE 0 END)::bigint AS gst
      FROM "LedgerTransaction" t
      -- Each transaction joined to its payee once (a return has two lines on the payee's account).
      JOIN (SELECT DISTINCT pe."transactionId", pa2.code, pa2."ownerType", pa2."ownerId"
            FROM "LedgerEntry" pe JOIN "LedgerAccount" pa2 ON pa2.id = pe."accountId" AND pa2."ownerType" IN ('VENDOR', 'PARTNER')) pa ON pa."transactionId" = t.id
      JOIN "LedgerEntry" e ON e."transactionId" = t.id
      JOIN "LedgerAccount" a ON a.id = e."accountId"
      WHERE t."occurredAt" >= ${start} AND t."occurredAt" < ${end} AND t.kind IN ('PARCEL_DELIVERED', 'PARCEL_RETURNED', 'BOOKING_EARNED')
      GROUP BY pa.code, pa."ownerType", pa."ownerId"`;
    const issued: Invoice[] = [];
    const skipped: Array<{ payee: string; reason: string }> = [];
    const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    for (const r of rows) {
      const revenue = Number(r.revenue);
      const gst = Number(r.gst);
      if (revenue + gst <= 0) {
        skipped.push({ payee: r.code, reason: 'No net fees this month (returns outweighed sales)' });
        continue;
      }
      const type = r.ownerType as PayeeType;
      const p = type === 'VENDOR'
        ? await this.prisma.vendor.findUniqueOrThrow({ where: { id: r.ownerId } })
        : await this.prisma.servicePartner.findUniqueOrThrow({ where: { id: r.ownerId } });
      const recipient: Party & { [k: string]: unknown } = { name: ('legalName' in p && p.legalName) || p.businessName, gstin: p.gstin, pan: p.pan, address: `${p.addressLine}, ${p.city} ${p.pincode}`, state: p.state };
      const line: InvoiceLine = {
        description: `${type === 'VENDOR' ? 'Marketplace commission' : 'Booking fees'}, ${label}`, hsnSac: s.sac || null, qty: 1, unitPaise: revenue + gst,
        taxablePaise: revenue, rateBps: revenue ? Math.round((gst * 10_000) / revenue) : 0, ...splitGst(gst, sameState(s.state, p.state)), totalPaise: revenue + gst,
      };
      const inv = await this.prisma.$transaction((tx) => this.issue(tx, {
        kind: 'COMMISSION', sourceKey: `${r.code}:${month}`, issuerKey: 'PETAPP', prefix: 'PA',
        issuer: { name: s.name, gstin: s.gstin, pan: s.pan || null, address: s.address, state: s.state }, recipient,
        placeOfSupply: p.state, lines: [line], payeeKey: r.code, issuedAt: new Date(end.getTime() - 1000),
      }));
      issued.push(inv);
    }
    return { month, issued: issued.map((i) => ({ id: i.id, number: i.number, payeeKey: i.payeeKey, totalPaise: i.totalPaise })), skipped };
  }

  async get(id: string) {
    const i = await this.prisma.invoice.findUnique({ where: { id } });
    if (!i) throw new NotFoundException('Invoice not found.');
    return i;
  }

  list(where: Prisma.InvoiceWhereInput, q: { skip: number; limit: number }) {
    return Promise.all([
      this.prisma.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, skip: q.skip, take: q.limit, select: { id: true, kind: true, title: true, number: true, issuedAt: true, totalPaise: true, sourceKey: true, recipient: true, issuer: true, payeeKey: true } }),
      this.prisma.invoice.count({ where }),
    ]);
  }
}
