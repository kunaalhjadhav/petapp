import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConsentService } from '../privacy/consent.service';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../providers/storage/storage.service';
import { Paged } from '../../common/dto/pagination.dto';
import { slugify } from '../../common/utils/slug';
import { normalizePhone } from '../../common/utils/phone';
import { PlatformService } from '../platform/platform.service';
import { MediaService, type MediaView } from '../media/media.service';
import { FinanceService } from '../finance/finance.service';
import { LedgerService } from '../finance/ledger.service';
import { InvoicesService } from '../finance/invoices.service';
import { inventoryStatus } from './marketplace.rules';
import { Prisma, type SubOrderStatus } from '../../generated/prisma/client';
import type {
  AdminVendorsQuery, ProductDto, UpdateProductDto, UpdateVendorProfileDto, VendorDocumentDto, VendorOrdersQuery, VendorProfileDto, VendorReviewDto, VariantDto,
} from './marketplace.dto';

type Tx = Prisma.TransactionClient;

/** Restores stock for a sub-order's lines (cancellation before shipping). */
export async function restock(tx: Tx, subOrderId: string) {
  const items = await tx.orderItem.findMany({ where: { subOrderId, variantId: { not: null } } });
  for (const i of items) await tx.productVariant.update({ where: { id: i.variantId! }, data: { stock: { increment: i.qty } } });
}


const VENDOR_FLOW: Partial<Record<SubOrderStatus, SubOrderStatus>> = { CONFIRMED: 'PACKED', PACKED: 'SHIPPED', SHIPPED: 'DELIVERED' };

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly platform: PlatformService,
    private readonly media: MediaService,
    private readonly finance: FinanceService,
    private readonly ledger: LedgerService,
    private readonly invoices: InvoicesService,
    private readonly consents: ConsentService,
  ) {}

  // ══════════════ onboarding ══════════════

  private async mine(userId: string) {
    const v = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!v) throw new NotFoundException('Set up your store first.');
    return v;
  }

  private async live(userId: string) {
    const v = await this.mine(userId);
    if (v.status !== 'APPROVED') throw new BadRequestException(v.status === 'SUSPENDED' ? 'Your store is paused.' : 'Your store isn’t approved yet.');
    return v;
  }

  private checklist(v: { documents: Array<{ kind: string; status: string }>; gstin: string | null }) {
    const missing: string[] = [];
    if (!v.documents.some((d) => d.kind === 'ID_PROOF' && d.status !== 'REJECTED')) missing.push('Upload an ID proof.');
    if (v.gstin && !v.documents.some((d) => d.kind === 'GST_CERTIFICATE' && d.status !== 'REJECTED')) missing.push('Upload your GST certificate.');
    return missing;
  }

  /** The vendor's own store, with private document links. null before onboarding starts. */
  async me(userId: string) {
    const v = await this.prisma.vendor.findUnique({ where: { userId }, include: { documents: { include: { media: true }, orderBy: { createdAt: 'asc' } } } });
    if (!v) return null;
    return { ...v, checklist: this.checklist(v), documents: await this.docs(v.documents) };
  }

  private docs(ds: Array<{ id: string; kind: string; status: string; note: string | null; createdAt: Date; media: { storageKey: string; mimeType: string } }>) {
    return Promise.all(ds.map(async (d) => ({ id: d.id, kind: d.kind, status: d.status, note: d.note, createdAt: d.createdAt, mimeType: d.media.mimeType, url: await this.storage.privateDocumentUrl(d.media.storageKey) })));
  }

  async create(userId: string, dto: VendorProfileDto) {
    if (await this.prisma.vendor.findUnique({ where: { userId } })) throw new ConflictException('You already have a store.');
    const v = await this.prisma.vendor.create({
      data: { ...dto, phone: normalizePhone(dto.phone)!, userId, slug: `${slugify(dto.businessName).replace(/\./g, '-')}-${randomBytes(3).toString('hex')}` },
    });
    await this.audit.log({ actorId: userId, action: 'vendor.create', entityType: 'Vendor', entityId: v.id, after: { businessName: v.businessName } });
    return this.me(userId);
  }

  async update(userId: string, dto: UpdateVendorProfileDto) {
    const v = await this.mine(userId);
    if (v.status === 'SUBMITTED') throw new BadRequestException('Your store is under review and can’t be changed right now.');
    await this.prisma.vendor.update({ where: { id: v.id }, data: { ...dto, phone: dto.phone ? normalizePhone(dto.phone)! : undefined } });
    return this.me(userId);
  }

  async addDocument(userId: string, dto: VendorDocumentDto) {
    const v = await this.mine(userId);
    const media = await this.prisma.mediaAsset.findFirst({ where: { id: dto.mediaId, ownerId: userId, kind: 'DOCUMENT', status: 'READY' } });
    if (!media) throw new BadRequestException('Upload the document first.');
    await this.prisma.vendorDocument.create({ data: { vendorId: v.id, kind: dto.kind, mediaId: media.id } });
    return this.me(userId);
  }

  async removeDocument(userId: string, id: string) {
    const v = await this.mine(userId);
    const d = await this.prisma.vendorDocument.findFirst({ where: { id, vendorId: v.id } });
    if (!d) throw new NotFoundException('Document not found.');
    if (d.status === 'ACCEPTED') throw new BadRequestException('Accepted documents can’t be removed. Contact support to replace one.');
    await this.prisma.vendorDocument.delete({ where: { id } });
    return this.me(userId);
  }

  async submit(userId: string) {
    const v = await this.prisma.vendor.findUniqueOrThrow({ where: { userId }, include: { documents: true } });
    if (v.status !== 'DRAFT' && v.status !== 'REJECTED') throw new BadRequestException('Your store has already been submitted.');
    const missing = this.checklist(v);
    if (missing.length) throw new BadRequestException({ message: 'A few things are still missing.', errors: missing.map((message) => ({ message })) });
    await this.consents.require(userId, 'vendor-terms');
    await this.prisma.vendor.update({ where: { id: v.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), statusReason: null } });
    await this.audit.log({ actorId: userId, action: 'vendor.submit', entityType: 'Vendor', entityId: v.id });
    return this.me(userId);
  }

  // ══════════════ admin review ══════════════

  async adminList(q: AdminVendorsQuery) {
    const where = { status: q.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({ where, orderBy: [{ submittedAt: 'asc' }, { createdAt: 'desc' }], skip: q.skip, take: q.limit, include: { _count: { select: { products: true } } } }),
      this.prisma.vendor.count({ where }),
    ]);
    return Paged.of(items.map(({ _count, ...v }) => ({ ...v, products: _count.products })), total, q);
  }

  async adminDetail(id: string) {
    const v = await this.prisma.vendor.findUnique({ where: { id }, include: { documents: { include: { media: true } }, user: { select: { id: true, name: true, phone: true } } } });
    if (!v) throw new NotFoundException('Vendor not found.');
    const [products, orders] = await Promise.all([
      this.prisma.product.groupBy({ by: ['status'], where: { vendorId: id }, _count: { _all: true } }),
      this.prisma.subOrder.groupBy({ by: ['status'], where: { vendorId: id }, _count: { _all: true } }),
    ]);
    return {
      ...v, documents: await this.docs(v.documents), checklist: this.checklist(v),
      products: Object.fromEntries(products.map((p) => [p.status, p._count._all])), orders: Object.fromEntries(orders.map((o) => [o.status, o._count._all])),
    };
  }

  async review(actorId: string, id: string, dto: VendorReviewDto) {
    const v = await this.prisma.vendor.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Vendor not found.');
    const next = { APPROVE: { from: ['SUBMITTED'], to: 'APPROVED' }, REJECT: { from: ['SUBMITTED'], to: 'REJECTED' }, SUSPEND: { from: ['APPROVED'], to: 'SUSPENDED' }, REINSTATE: { from: ['SUSPENDED'], to: 'APPROVED' } } as const;
    const step = next[dto.decision];
    if (!(step.from as readonly string[]).includes(v.status)) throw new BadRequestException(`Can’t ${dto.decision.toLowerCase()} a store that is ${v.status.toLowerCase()}.`);
    if ((dto.decision === 'REJECT' || dto.decision === 'SUSPEND') && !dto.reason) throw new BadRequestException('Give a reason. The vendor will see it.');
    if (dto.decision === 'APPROVE') {
      const docs = await this.prisma.vendorDocument.findMany({ where: { vendorId: id } });
      const decided = new Map((dto.documents ?? []).map((d) => [d.id, d.status]));
      if (!docs.some((d) => d.kind === 'ID_PROOF' && (decided.get(d.id) ?? d.status) === 'ACCEPTED')) throw new BadRequestException('Accept the vendor’s ID proof before approving.');
      if (v.gstin && !docs.some((d) => d.kind === 'GST_CERTIFICATE' && (decided.get(d.id) ?? d.status) === 'ACCEPTED')) {
        throw new BadRequestException('This vendor gave a GSTIN: accept their GST certificate before approving.');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      for (const d of dto.documents ?? []) await tx.vendorDocument.updateMany({ where: { id: d.id, vendorId: id }, data: { status: d.status, note: d.note } });
      await tx.vendor.update({ where: { id }, data: { status: step.to, statusReason: dto.reason ?? null, reviewedAt: new Date(), reviewedById: actorId } });
      if (step.to === 'APPROVED') {
        const role = await tx.role.findUniqueOrThrow({ where: { key: 'PRODUCT_PARTNER' } });
        await tx.userRole.createMany({ data: [{ userId: v.userId, roleId: role.id }], skipDuplicates: true });
      }
      await this.audit.log({ actorId, action: `vendor.${dto.decision.toLowerCase()}`, entityType: 'Vendor', entityId: id, before: { status: v.status }, after: { status: step.to, reason: dto.reason } }, tx);
    });
    this.queue.notify({ type: 'VENDOR_STATUS', vendorId: id });
    return this.adminDetail(id);
  }

  async setCommission(actorId: string, id: string, commissionBps: number | null) {
    const v = await this.prisma.vendor.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Vendor not found.');
    await this.prisma.vendor.update({ where: { id }, data: { commissionBps } });
    await this.audit.log({ actorId, action: 'vendor.commission', entityType: 'Vendor', entityId: id, before: { commissionBps: v.commissionBps }, after: { commissionBps } });
    return { id, commissionBps };
  }

  // ══════════════ catalogue (vendor) ══════════════

  private async assertImages(userId: string, ids: string[] | undefined) {
    if (!ids?.length) return;
    const ok = await this.prisma.mediaAsset.count({ where: { id: { in: ids }, ownerId: userId, kind: 'IMAGE', status: 'READY' } });
    if (ok !== new Set(ids).size) throw new BadRequestException('Every image must be one of your finished photo uploads.');
  }

  private assertVariants(vs: VariantDto[]) {
    if (!vs.length) throw new BadRequestException('Add at least one variant (size, weight or colour) with a price.');
    const skus = vs.map((v) => v.sku);
    if (new Set(skus).size !== skus.length) throw new BadRequestException('Each variant needs its own SKU.');
    const bad = vs.find((v) => v.pricePaise > v.mrpPaise);
    if (bad) throw new BadRequestException(`${bad.title}: the selling price can’t be above the MRP.`);
  }

  /** The seller's products, each variant with its inventory status (in stock, low, out, discontinued). */
  async myProducts(userId: string) {
    const v = await this.mine(userId);
    const low = await this.platform.getSetting<number>('marketplace.lowStockThreshold');
    const products = await this.prisma.product.findMany({
      where: { vendorId: v.id },
      orderBy: { updatedAt: 'desc' },
      include: { variants: { orderBy: { createdAt: 'asc' } }, category: { select: { id: true, name: true } } },
    });
    // Photos come back viewable so the seller's app can show them, in the order the seller chose.
    const ids = [...new Set(products.flatMap((p) => p.imageIds))];
    const assets = ids.length ? await this.prisma.mediaAsset.findMany({ where: { id: { in: ids }, status: 'READY' } }) : [];
    const views = new Map<string, MediaView>(await Promise.all(assets.map(async (a) => [a.id, await this.media.view(a)] as const)));
    return products.map((p) => ({
      ...p,
      images: p.imageIds.flatMap((id) => views.get(id) ?? []),
      variants: p.variants.map((x) => ({ ...x, inventoryStatus: inventoryStatus(x, low) })),
    }));
  }

  /**
   * The seller's home screen: what needs doing now, stock to top up, and sales so far.
   * Sales windows start at midnight India time; they count paid parcels that weren't cancelled or returned.
   */
  async dashboard(userId: string) {
    const v = await this.mine(userId);
    const low = await this.platform.getSetting<number>('marketplace.lowStockThreshold');
    const IST = 330 * 60_000;
    const now = Date.now();
    const todayStart = new Date(Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST);
    const since = (days: number) => new Date(todayStart.getTime() - (days - 1) * 86_400_000);
    const sold: Prisma.SubOrderWhereInput = { vendorId: v.id, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURN_REQUESTED'] } };
    const window = (from: Date) =>
      this.prisma.subOrder.aggregate({ where: { ...sold, createdAt: { gte: from } }, _count: { _all: true }, _sum: { totalPaise: true, vendorEarningPaise: true } });
    const [byStatus, returns, today, week, month, products, stockRows] = await Promise.all([
      this.prisma.subOrder.groupBy({ by: ['status'], where: { vendorId: v.id, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED'] } }, _count: { _all: true } }),
      this.prisma.returnRequest.count({ where: { status: 'REQUESTED', subOrder: { vendorId: v.id } } }),
      window(todayStart),
      window(since(7)),
      window(since(30)),
      this.prisma.product.groupBy({ by: ['status'], where: { vendorId: v.id }, _count: { _all: true } }),
      this.prisma.productVariant.findMany({
        where: { isActive: true, stock: { lte: low }, product: { vendorId: v.id, status: 'ACTIVE' } },
        orderBy: [{ stock: 'asc' }, { updatedAt: 'desc' }],
        take: 20,
        include: { product: { select: { id: true, title: true } } },
      }),
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const sales = (a: Awaited<ReturnType<typeof window>>) => ({ orders: a._count._all, salesPaise: a._sum.totalPaise ?? 0, earningsPaise: a._sum.vendorEarningPaise ?? 0 });
    return {
      store: { businessName: v.businessName, status: v.status, statusReason: v.statusReason },
      todo: { toPack: count('CONFIRMED'), toShip: count('PACKED'), inTransit: count('SHIPPED'), returnsToReview: returns },
      sales: { today: sales(today), last7Days: sales(week), last30Days: sales(month) },
      products: Object.fromEntries(products.map((p) => [p.status, p._count._all])),
      lowStockThreshold: low,
      stockAlerts: stockRows.map((x) => ({
        variantId: x.id, productId: x.product.id, productTitle: x.product.title, variantTitle: x.title, sku: x.sku, stock: x.stock, inventoryStatus: inventoryStatus(x, low),
      })),
    };
  }

  async createProduct(userId: string, dto: ProductDto) {
    const v = await this.live(userId);
    await this.assertCategory(dto.categoryId);
    await this.assertImages(userId, dto.imageIds);
    this.assertVariants(dto.variants);
    const { variants, ...rest } = dto;
    const p = await this.prisma.product.create({
      data: { ...rest, vendorId: v.id, slug: `${slugify(dto.title).replace(/\./g, '-')}-${randomBytes(3).toString('hex')}`, status: 'DRAFT', variants: { create: variants } },
      include: { variants: true },
    });
    await this.audit.log({ actorId: userId, action: 'product.create', entityType: 'Product', entityId: p.id, after: { title: p.title, variants: variants.length } });
    this.queue.assess('PRODUCT', p.id);
    return p;
  }

  async updateProduct(userId: string, id: string, dto: UpdateProductDto) {
    const v = await this.live(userId);
    const p = await this.prisma.product.findFirst({ where: { id, vendorId: v.id }, include: { variants: true } });
    if (!p) throw new NotFoundException('Product not found.');
    if (p.status === 'BLOCKED') throw new BadRequestException(`This product was blocked by PetApp${p.blockReason ? `: ${p.blockReason}` : ''}. Contact support.`);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    await this.assertImages(userId, dto.imageIds);
    if (dto.variants) this.assertVariants(dto.variants);
    if (dto.status === 'ACTIVE') {
      const images = dto.imageIds ?? p.imageIds;
      const variants = dto.variants ?? p.variants;
      if (!images.length) throw new BadRequestException('Add at least one photo before going live.');
      if (!variants.some((x) => x.isActive !== false)) throw new BadRequestException('Add at least one active variant before going live.');
    }
    const { variants, ...rest } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: rest });
      if (variants) {
        // Upsert by SKU; variants no longer listed are deactivated (never deleted: past orders point at them).
        // An existing variant keeps its stock: orders change it while the seller edits, so a saved form must not
        // write an old count back. Stock moves through PUT /vendor/variants/:id/stock.
        for (const x of variants) {
          await tx.productVariant.upsert({
            where: { productId_sku: { productId: id, sku: x.sku } },
            update: { ...x, stock: undefined, isActive: x.isActive ?? true },
            create: { ...x, productId: id },
          });
        }
        await tx.productVariant.updateMany({ where: { productId: id, sku: { notIn: variants.map((x) => x.sku) } }, data: { isActive: false } });
      }
    });
    await this.audit.log({ actorId: userId, action: 'product.update', entityType: 'Product', entityId: id, after: { fields: Object.keys(dto) } });
    // Listing text and photos are checked again when they change (unchanged content isn't re-checked).
    if (dto.title !== undefined || dto.description !== undefined || dto.brand !== undefined || dto.imageIds !== undefined) this.queue.assess('PRODUCT', id);
    return this.prisma.product.findUniqueOrThrow({ where: { id }, include: { variants: { orderBy: { createdAt: 'asc' } } } });
  }

  async setStock(userId: string, variantId: string, stock: number) {
    const v = await this.mine(userId);
    const r = await this.prisma.productVariant.updateMany({ where: { id: variantId, product: { vendorId: v.id } }, data: { stock } });
    if (!r.count) throw new NotFoundException('Variant not found.');
    return { variantId, stock };
  }

  private async assertCategory(id: string) {
    const c = await this.prisma.productCategory.findFirst({ where: { id, isActive: true } });
    if (!c) throw new BadRequestException('Choose an active category.');
  }

  // ══════════════ fulfilment ══════════════

  async orders(userId: string, q: VendorOrdersQuery) {
    const v = await this.mine(userId);
    const where: Prisma.SubOrderWhereInput = { vendorId: v.id, status: q.status ?? { not: 'PENDING_PAYMENT' } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit,
        include: { items: true, returns: { orderBy: { createdAt: 'desc' } }, order: { select: { code: true, shipTo: true, user: { select: { name: true, phone: true } } } } },
      }),
      this.prisma.subOrder.count({ where }),
    ]);
    return Paged.of(items.map((s) => this.vendorView(s)), total, q);
  }

  private vendorView(s: Prisma.SubOrderGetPayload<{ include: { items: true; returns: true; order: { select: { code: true; shipTo: true; user: { select: { name: true; phone: true } } } } } }>) {
    const { order, ...rest } = s;
    return { ...rest, orderCode: order.code, customer: order.user, shipTo: order.shipTo };
  }

  async advance(userId: string, subOrderId: string, to: 'PACKED' | 'SHIPPED' | 'DELIVERED', ship?: { courier: string; trackingNumber: string }) {
    const v = await this.mine(userId);
    const s = await this.prisma.subOrder.findFirst({ where: { id: subOrderId, vendorId: v.id } });
    if (!s) throw new NotFoundException('Order not found.');
    if (VENDOR_FLOW[s.status] !== to) throw new BadRequestException(`A ${s.status.toLowerCase().replace(/_/g, ' ')} order can’t be marked ${to.toLowerCase()}.`);
    if (to === 'SHIPPED' && !ship) throw new BadRequestException('Add the courier and tracking number.');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.subOrder.updateMany({
        where: { id: s.id, status: s.status },
        data: { status: to, ...(to === 'PACKED' ? { packedAt: now } : to === 'SHIPPED' ? { shippedAt: now, ...ship } : { deliveredAt: now }) },
      });
      if (!r.count) throw new ConflictException('This order just changed. Refresh and try again.');
      if (to === 'DELIVERED') {
        await this.finance.parcelDelivered(tx, s.id);
        await this.invoices.forParcel(tx, s.id);
        await this.completeOrderIfDone(tx, s.orderId);
      }
      await this.audit.log({ actorId: userId, action: `sub_order.${to.toLowerCase()}`, entityType: 'SubOrder', entityId: s.id, before: { status: s.status }, after: { status: to, ...ship } }, tx);
    });
    if (to !== 'PACKED') this.queue.notify({ type: 'ORDER_UPDATE', subOrderId: s.id, to: 'customer' });
    return this.one(s.id);
  }

  async vendorCancel(userId: string, subOrderId: string, reason: string) {
    const v = await this.mine(userId);
    const s = await this.prisma.subOrder.findFirst({ where: { id: subOrderId, vendorId: v.id }, include: { order: true } });
    if (!s) throw new NotFoundException('Order not found.');
    if (s.status !== 'CONFIRMED' && s.status !== 'PACKED') throw new BadRequestException('Orders can only be cancelled before they ship.');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.subOrder.updateMany({ where: { id: s.id, status: s.status }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'VENDOR', cancelReason: reason } });
      if (!r.count) throw new ConflictException('This order just changed. Refresh and try again.');
      await restock(tx, s.id);
      await this.finance.oweRefund(tx, { paymentId: s.order.paymentId, amountPaise: s.totalPaise, reason: 'SUB_ORDER_CANCELLED', reference: `SubOrder:${s.id}` });
      await this.completeOrderIfDone(tx, s.orderId);
      await this.audit.log({ actorId: userId, action: 'sub_order.cancel', entityType: 'SubOrder', entityId: s.id, after: { by: 'VENDOR', reason, refundPaise: s.totalPaise } }, tx);
    });
    this.queue.notify({ type: 'ORDER_UPDATE', subOrderId: s.id, to: 'customer' });
    return this.one(s.id);
  }

  async decideReturn(userId: string, returnId: string, decision: 'APPROVE' | 'REJECT' | 'RECEIVED', note?: string) {
    const v = await this.mine(userId);
    const r = await this.prisma.returnRequest.findFirst({ where: { id: returnId, subOrder: { vendorId: v.id } }, include: { subOrder: { include: { order: true } } } });
    if (!r) throw new NotFoundException('Return not found.');
    const from = { APPROVE: 'REQUESTED', REJECT: 'REQUESTED', RECEIVED: 'APPROVED' }[decision];
    if (r.status !== from) throw new BadRequestException(`This return is ${r.status.toLowerCase()}.`);
    if (decision === 'REJECT' && !note) throw new BadRequestException('Tell the customer why the return can’t be accepted.');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.returnRequest.updateMany({
        where: { id: r.id, status: r.status },
        data: decision === 'RECEIVED' ? { status: 'RECEIVED', receivedAt: now, note: note ?? r.note } : { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedAt: now, note },
      });
      if (!moved.count) throw new ConflictException('This return just changed. Refresh and try again.');
      if (decision === 'REJECT') await tx.subOrder.update({ where: { id: r.subOrderId }, data: { status: 'DELIVERED' } });
      if (decision === 'RECEIVED') {
        await tx.subOrder.update({ where: { id: r.subOrderId }, data: { status: 'RETURNED' } });
        await restock(tx, r.subOrderId);
        await this.finance.parcelReturned(tx, r.subOrderId, r.refundPaise);
        await this.invoices.forReturn(tx, r.id);
        await this.finance.oweRefund(tx, { paymentId: r.subOrder.order.paymentId, amountPaise: r.refundPaise, reason: 'RETURN', reference: `Return:${r.id}` });
      }
      await this.audit.log({ actorId: userId, action: `return.${decision.toLowerCase()}`, entityType: 'ReturnRequest', entityId: r.id, after: { note } }, tx);
    });
    this.queue.notify({ type: 'ORDER_UPDATE', subOrderId: r.subOrderId, to: 'customer' });
    return this.one(r.subOrderId);
  }

  private async one(id: string) {
    const s = await this.prisma.subOrder.findUniqueOrThrow({
      where: { id },
      include: { items: true, returns: { orderBy: { createdAt: 'desc' } }, order: { select: { code: true, shipTo: true, user: { select: { name: true, phone: true } } } } },
    });
    return this.vendorView(s);
  }

  /** The master order is COMPLETED once every parcel has reached an end state, CANCELLED if none was delivered. */
  async completeOrderIfDone(tx: Tx, orderId: string) {
    const subs = await tx.subOrder.findMany({ where: { orderId }, select: { status: true } });
    const final = ['DELIVERED', 'CANCELLED', 'RETURNED'];
    if (!subs.every((s) => final.includes(s.status))) return;
    await tx.order.update({ where: { id: orderId }, data: { status: subs.every((s) => s.status === 'CANCELLED') ? 'CANCELLED' : 'COMPLETED' } });
  }

  /** Earnings from delivered parcels by month (India time), what's in transit, and refunds. Payouts arrive with Phase 6. */
  async earnings(userId: string) {
    const v = await this.mine(userId);
    const [delivered, pending, months] = await Promise.all([
      this.prisma.subOrder.aggregate({ where: { vendorId: v.id, status: 'DELIVERED' }, _count: { _all: true }, _sum: { totalPaise: true, commissionPaise: true, vendorEarningPaise: true } }),
      this.prisma.subOrder.aggregate({ where: { vendorId: v.id, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED'] } }, _count: { _all: true }, _sum: { vendorEarningPaise: true } }),
      this.prisma.$queryRaw<Array<{ month: string; orders: bigint; earned: bigint; commission: bigint }>>`
        SELECT to_char(date_trunc('month', ("deliveredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
               count(*) AS orders, sum("vendorEarningPaise") AS earned, sum("commissionPaise") AS commission
        FROM "SubOrder" WHERE "vendorId" = ${v.id}::uuid AND status = 'DELIVERED' GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    ]);
    return {
      delivered: { orders: delivered._count._all, salesPaise: delivered._sum.totalPaise ?? 0, commissionPaise: delivered._sum.commissionPaise ?? 0, earnedPaise: delivered._sum.vendorEarningPaise ?? 0 },
      inProgress: { orders: pending._count._all, expectedPaise: pending._sum.vendorEarningPaise ?? 0 },
      months: months.map((m) => ({ month: m.month, orders: Number(m.orders), earnedPaise: Number(m.earned), commissionPaise: Number(m.commission) })),
      // What PetApp owes the seller now, from the ledger: earnings after TCS and TDS, less returns.
      balancePaise: await this.ledger.balance(`VENDOR:${v.id}`),
      payouts: 'Earnings become payable once the return window is over, and are paid to your bank account or UPI ID in regular payout batches. Your statement shows every sale, fee and tax deduction.',
    };
  }
}
