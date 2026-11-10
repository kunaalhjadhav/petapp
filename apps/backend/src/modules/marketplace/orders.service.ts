import { likeText } from '../../common/utils/search';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../../queue/queue.service';
import { PaymentsService } from '../payments/payments.service';
import { PlatformService } from '../platform/platform.service';
import { MediaService } from '../media/media.service';
import { Paged } from '../../common/dto/pagination.dto';
import { ReviewsService } from '../reviews/reviews.service';
import { MembershipsService } from '../memberships/memberships.service';
import { LocationsService, type Delivery } from '../locations/locations.service';
import { parcelReceived } from '../reviews/reviews.rules';
import { Prisma, type Coupon } from '../../generated/prisma/client';
import { orderCode, quote, returnWindowOpen, type QuoteLine } from './marketplace.rules';
import { VendorsService, restock } from './vendors.service';
import { FinanceService } from '../finance/finance.service';
import type {
  AdminOrdersQuery, AdminProductsQuery, CouponDto, ProductCategoryDto, ProductsQuery, UpdateCouponDto, UpdateVendorCouponDto, VendorCouponDto,
} from './marketplace.dto';

type Tx = Prisma.TransactionClient;
const LIVE_PRODUCT: Prisma.ProductWhereInput = { status: 'ACTIVE', vendor: { status: 'APPROVED' } };

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly payments: PaymentsService,
    private readonly platform: PlatformService,
    private readonly media: MediaService,
    private readonly vendors: VendorsService,
    private readonly finance: FinanceService,
    private readonly reviews: ReviewsService,
    private readonly locations: LocationsService,
    private readonly memberships: MembershipsService,
  ) {}

  onModuleInit() {
    this.payments.registerSettler('PRODUCT_ORDER', (tx, payment) => this.settlePaid(tx, payment.id));
  }

  // ══════════════ catalogue (public) ══════════════

  categories() {
    return this.prisma.productCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, key: true, name: true, parentId: true } });
  }

  private async images(ids: string[]) {
    if (!ids.length) return [];
    const assets = await this.prisma.mediaAsset.findMany({ where: { id: { in: ids }, status: 'READY' } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return Promise.all(ids.filter((id) => byId.has(id)).map((id) => this.media.view(byId.get(id)!)));
  }

  async products(q: ProductsQuery) {
    const where: Prisma.ProductWhereInput = {
      ...LIVE_PRODUCT,
      categoryId: q.categoryId ? { in: await this.withChildren(q.categoryId) } : undefined,
      vendorId: q.vendorId,
      ...(q.speciesId ? { OR: [{ speciesIds: { has: q.speciesId } }, { speciesIds: { isEmpty: true } }] } : {}),
      ...(q.q ? { AND: [{ OR: [{ title: { contains: likeText(q.q), mode: 'insensitive' } }, { brand: { contains: likeText(q.q), mode: 'insensitive' } }] }] } : {}),
      variants: { some: { isActive: true } },
    };
    const rows = await this.prisma.product.findMany({
      where,
      include: { variants: { where: { isActive: true } }, vendor: { select: { id: true, businessName: true, slug: true } } },
      orderBy: q.sort === 'newest' ? { createdAt: 'desc' } : q.sort === 'rating' ? [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }, { updatedAt: 'desc' }] : { updatedAt: 'desc' },
    });
    const cards = await Promise.all(rows.map(async (p) => this.card(p)));
    if (q.sort === 'price_asc') cards.sort((a, b) => a.fromPaise - b.fromPaise);
    if (q.sort === 'price_desc') cards.sort((a, b) => b.fromPaise - a.fromPaise);
    return Paged.of(cards.slice(q.skip, q.skip + q.limit), cards.length, q);
  }

  /** Product cards for these ids, in this order; anything no longer for sale is left out. */
  async cardsByIds(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { ...LIVE_PRODUCT, id: { in: ids }, variants: { some: { isActive: true } } },
      include: { variants: { where: { isActive: true } }, vendor: { select: { id: true, businessName: true, slug: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return Promise.all(ids.filter((id) => byId.has(id)).map((id) => this.card(byId.get(id)!)));
  }

  private async withChildren(categoryId: string) {
    const kids = await this.prisma.productCategory.findMany({ where: { parentId: categoryId }, select: { id: true } });
    return [categoryId, ...kids.map((k) => k.id)];
  }

  private async card(p: Prisma.ProductGetPayload<{ include: { variants: true; vendor: { select: { id: true; businessName: true; slug: true } } } }>) {
    const prices = p.variants.map((v) => v.pricePaise);
    const cheapest = p.variants.reduce((a, b) => (b.pricePaise < a.pricePaise ? b : a), p.variants[0]);
    return {
      id: p.id, slug: p.slug, title: p.title, brand: p.brand, vendor: p.vendor,
      image: (await this.images(p.imageIds.slice(0, 1)))[0] ?? null,
      fromPaise: Math.min(...prices), mrpPaise: cheapest?.mrpPaise ?? 0,
      inStock: p.variants.some((v) => v.stock > 0),
      ratingAvg: p.ratingAvg, ratingCount: p.ratingCount,
    };
  }

  async product(idOrSlug: string) {
    const p = await this.prisma.product.findFirst({
      where: { ...LIVE_PRODUCT, OR: [{ slug: idOrSlug }, ...(/^[0-9a-f-]{36}$/.test(idOrSlug) ? [{ id: idOrSlug }] : [])] },
      include: { variants: { where: { isActive: true }, orderBy: { pricePaise: 'asc' } }, vendor: { select: { id: true, businessName: true, slug: true, city: true, ratingAvg: true, ratingCount: true } }, category: { select: { id: true, name: true } } },
    });
    if (!p) throw new NotFoundException('Product not found.');
    const low = await this.platform.getSetting<number>('marketplace.lowStockThreshold');
    return {
      id: p.id, slug: p.slug, title: p.title, description: p.description, brand: p.brand, speciesIds: p.speciesIds, category: p.category, vendor: p.vendor,
      images: await this.images(p.imageIds),
      variants: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, mrpPaise: v.mrpPaise, pricePaise: v.pricePaise, inStock: v.stock > 0, lowStock: v.stock > 0 && v.stock <= low ? v.stock : null })),
      ratingAvg: p.ratingAvg, ratingCount: p.ratingCount,
      ...(await this.reviewBlock(p.id)),
    };
  }

  /** The star breakdown and the latest three reviews. */
  private async reviewBlock(productId: string) {
    const { summary, recent } = await this.reviews.productBlock(productId);
    return { ratingSummary: summary, reviews: recent };
  }

  // ══════════════ cart ══════════════

  async setCartItem(userId: string, variantId: string, qty: number) {
    if (qty === 0) {
      await this.prisma.cartItem.deleteMany({ where: { userId, variantId } });
      return this.cart(userId);
    }
    const max = await this.platform.getSetting<number>('marketplace.maxQtyPerItem');
    if (qty > max) throw new BadRequestException(`You can order up to ${max} of each item.`);
    const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, isActive: true, product: LIVE_PRODUCT } });
    if (!v) throw new NotFoundException('This item isn’t available.');
    if (v.stock < qty) throw new BadRequestException(v.stock === 0 ? 'This item is out of stock.' : `Only ${v.stock} left.`);
    await this.prisma.cartItem.upsert({ where: { userId_variantId: { userId, variantId } }, update: { qty }, create: { userId, variantId, qty } });
    return this.cart(userId);
  }

  async clearCart(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return this.cart(userId);
  }

  private cartRows(userId: string) {
    return this.prisma.cartItem.findMany({
      where: { userId },
      orderBy: { addedAt: 'asc' },
      include: { variant: { include: { product: { include: { vendor: true, category: true } } } } },
    });
  }

  /**
   * Cart with each line's availability and a full price breakdown (optionally with a coupon). With an address,
   * shipping follows its delivery zone and the result says whether (and how fast) it can be delivered there.
   */
  async cart(userId: string, couponCode?: string, addressId?: string) {
    const rows = await this.cartRows(userId);
    const address = addressId ? await this.prisma.address.findFirst({ where: { id: addressId, userId } }) : null;
    if (addressId && !address) throw new NotFoundException('Address not found.');
    const delivery = address ? await this.locations.delivery(address) : null;
    const problems: Record<string, string> = {};
    for (const r of rows) {
      const v = r.variant;
      if (!v.isActive || v.product.status !== 'ACTIVE' || v.product.vendor.status !== 'APPROVED') problems[v.id] = 'No longer available. Remove it to continue.';
      else if (v.stock < r.qty) problems[v.id] = v.stock === 0 ? 'Out of stock. Remove it to continue.' : `Only ${v.stock} left. Lower the quantity to continue.`;
    }
    const ok = rows.filter((r) => !problems[r.variantId]);
    const coupon = couponCode ? await this.findCoupon(userId, couponCode) : null;
    const q = quote(ok.map((r) => this.quoteLine(r)), coupon?.rule ?? null, await this.shippingRule(delivery));
    const images = await this.images(rows.map((r) => r.variant.product.imageIds[0]).filter(Boolean));
    const imageById = new Map(images.map((i) => [i.id, i]));
    return {
      items: rows.map((r) => ({
        variantId: r.variantId, qty: r.qty, productId: r.variant.productId, productTitle: r.variant.product.title, variantTitle: r.variant.title,
        vendor: { id: r.variant.product.vendor.id, businessName: r.variant.product.vendor.businessName },
        unitPricePaise: r.variant.pricePaise, mrpPaise: r.variant.mrpPaise, image: imageById.get(r.variant.product.imageIds[0]) ?? null, problem: problems[r.variantId] ?? null,
      })),
      parcels: q.vendors.map((v) => ({ vendorId: v.vendorId, itemsPaise: v.itemsPaise, discountPaise: v.discountPaise, shippingPaise: v.shippingPaise, totalPaise: v.totalPaise })),
      itemsPaise: q.itemsPaise, discountPaise: q.discountPaise, shippingPaise: q.shippingPaise, totalPaise: q.totalPaise,
      coupon: q.coupon, couponProblem: coupon?.problem ?? q.couponProblem,
      delivery: delivery ? { deliverable: delivery.deliverable, zone: delivery.zone, line: delivery.line, minDays: delivery.minDays, maxDays: delivery.maxDays, problem: delivery.problem } : null,
      canCheckout: ok.length > 0 && ok.length === rows.length && (delivery?.deliverable ?? true),
    };
  }

  private quoteLine(r: Awaited<ReturnType<OrdersService['cartRows']>>[number]): QuoteLine {
    const p = r.variant.product;
    return { variantId: r.variantId, vendorId: p.vendorId, qty: r.qty, unitPricePaise: r.variant.pricePaise, gstRateBps: r.variant.gstRateBps, commissionBps: p.vendor.commissionBps ?? p.category.commissionBps };
  }

  /** The standard shipping settings, or the delivery zone's own charges where it sets them. */
  private async shippingRule(delivery?: Delivery | null) {
    const flat = delivery?.shipping?.flatPaise ?? (await this.platform.getSetting<number>('marketplace.shippingFlatPaise'));
    const free = delivery?.shipping?.freeAbovePaise ?? (await this.platform.getSetting<number>('marketplace.freeShippingAbovePaise'));
    return { flatPaise: flat, freeAbovePaise: free };
  }

  /** A coupon usable by this user right now, or the reason it isn't. */
  private async findCoupon(userId: string, code: string): Promise<{ coupon: Coupon | null; rule: Coupon & { maxDiscountPaise: number | null } | null; problem: string | null }> {
    const c = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    const now = new Date();
    const fail = (problem: string) => ({ coupon: null, rule: null, problem });
    if (!c || !c.isActive) return fail('That coupon code isn’t valid.');
    if (now < c.startsAt) return fail('That coupon isn’t active yet.');
    if (now > c.endsAt) return fail('That coupon has expired.');
    if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return fail('That coupon has been fully used.');
    const mine = await this.prisma.couponRedemption.count({ where: { couponId: c.id, userId, order: { status: { notIn: ['CANCELLED', 'EXPIRED'] } } } });
    if (mine >= c.perUserLimit) return fail('You’ve already used this coupon.');
    if (c.membersOnly) {
      const problem = await this.memberships.membersOnlyProblem(userId, 'memberDiscounts');
      if (problem) return fail(problem);
    }
    return { coupon: c, rule: c, problem: null };
  }

  // ══════════════ placing an order ══════════════

  /**
   * Turns the cart into an order: re-prices it, reserves stock atomically (every variant decrement is
   * conditional on enough stock — racing buyers can't oversell), splits into a sub-order per vendor,
   * and opens one payment for the total. Stock is held until the payment hold expires.
   */
  async place(userId: string, addressId: string, couponCode?: string) {
    await this.expireStale();
    const address = await this.prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) throw new NotFoundException('Address not found.');
    const rows = await this.cartRows(userId);
    if (!rows.length) throw new BadRequestException('Your cart is empty.');
    const preview = await this.cart(userId, couponCode, addressId);
    if (preview.delivery && !preview.delivery.deliverable) throw new BadRequestException(preview.delivery.problem ?? 'We can’t deliver to this address yet.');
    if (!preview.canCheckout) throw new BadRequestException('Some items in your cart need attention before checkout.');
    if (couponCode && preview.couponProblem) throw new BadRequestException(preview.couponProblem);
    const coupon = couponCode ? (await this.findCoupon(userId, couponCode)).coupon : null;
    const q = quote(rows.map((r) => this.quoteLine(r)), coupon, await this.shippingRule(await this.locations.delivery(address)));
    const byVariant = new Map(rows.map((r) => [r.variantId, r]));
    // The parcel goes to the buyer: their name and phone go on the courier label (the address label is just "Home"/"Work").
    const buyer = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, phone: true } });
    const shipTo = {
      name: buyer.name, phone: buyer.phone, label: address.label,
      line1: address.line1, line2: address.line2, locality: address.locality, city: address.city, state: address.state, pincode: address.pincode,
    };

    const order = await this.prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const n = await tx.productVariant.updateMany({ where: { id: r.variantId, isActive: true, stock: { gte: r.qty } }, data: { stock: { decrement: r.qty } } });
        if (!n.count) throw new ConflictException(`${r.variant.product.title} (${r.variant.title}) just sold out. Your cart has been updated.`);
      }
      if (coupon) {
        const n = await tx.coupon.updateMany({ where: { id: coupon.id, OR: [{ usageLimit: null }, { usedCount: { lt: coupon.usageLimit ?? 0 } }] }, data: { usedCount: { increment: 1 } } });
        if (!n.count) throw new ConflictException('That coupon has just been fully used.');
      }
      const o = await tx.order.create({
        data: {
          code: orderCode('PO', randomBytes(8)), userId, itemsPaise: q.itemsPaise, discountPaise: q.discountPaise, shippingPaise: q.shippingPaise, totalPaise: q.totalPaise,
          couponId: coupon?.id, shipTo,
          subOrders: {
            create: q.vendors.map((v, i) => ({
              vendorId: v.vendorId, code: `${orderCode('SO', randomBytes(8))}${i}`, itemsPaise: v.itemsPaise, discountPaise: v.discountPaise, shippingPaise: v.shippingPaise,
              totalPaise: v.totalPaise, commissionPaise: v.commissionPaise, vendorEarningPaise: v.vendorEarningPaise,
              items: {
                create: v.lines.map((l) => {
                  const r = byVariant.get(l.variantId)!;
                  return {
                    variantId: l.variantId, productTitle: r.variant.product.title, variantTitle: r.variant.title, sku: r.variant.sku, qty: l.qty,
                    unitPricePaise: l.unitPricePaise, gstRateBps: l.gstRateBps, gstPaise: l.gstPaise, lineTotalPaise: l.lineTotalPaise, commissionBps: l.commissionBps,
                  };
                }),
              },
            })),
          },
        },
      });
      if (coupon) await tx.couponRedemption.create({ data: { couponId: coupon.id, userId, orderId: o.id } });
      const payment = await this.payments.createOrder(tx, userId, 'PRODUCT_ORDER', o.id, q.totalPaise, { orderId: o.id, code: o.code });
      await tx.order.update({ where: { id: o.id }, data: { paymentId: payment.id } });
      await tx.cartItem.deleteMany({ where: { userId } });
      await this.audit.log({ actorId: userId, action: 'order.place', entityType: 'Order', entityId: o.id, after: { totalPaise: q.totalPaise, parcels: q.vendors.length, coupon: coupon?.code } }, tx);
      return { o, payment };
    });
    return { order: await this.customerOrder(userId, order.o.id), payment: this.payments.checkoutParams(order.payment) };
  }

  /**
   * Payment captured. Normally PENDING_PAYMENT → PAID. If the hold had expired (stock released), try to
   * reserve it again; if that's no longer possible, the whole amount is refunded.
   */
  private async settlePaid(tx: Tx, paymentId: string): Promise<'ok' | 'refund'> {
    const o = await tx.order.findUnique({ where: { paymentId }, include: { subOrders: { include: { items: true } } } });
    if (!o) return 'refund';
    if (o.status === 'EXPIRED') {
      const lines = o.subOrders.flatMap((s) => s.items).filter((i) => i.variantId);
      for (const l of lines) {
        const n = await tx.productVariant.updateMany({ where: { id: l.variantId!, stock: { gte: l.qty } }, data: { stock: { decrement: l.qty } } });
        if (!n.count) {
          // Undo what we re-reserved in this attempt, then refund.
          for (const done of lines.slice(0, lines.indexOf(l))) await tx.productVariant.update({ where: { id: done.variantId! }, data: { stock: { increment: done.qty } } });
          await this.finance.oweRefund(tx, { paymentId, amountPaise: o.totalPaise, reason: 'ORDER_UNFULFILLABLE', reference: `Order:${o.id}` });
          return 'ok'; // the refund row carries it; the payment itself stays CAPTURED
        }
      }
      // Revived: take back the coupon use that expiry released.
      if (o.couponId) await tx.coupon.update({ where: { id: o.couponId }, data: { usedCount: { increment: 1 } } });
    } else if (o.status !== 'PENDING_PAYMENT') {
      return 'ok';
    }
    await tx.order.update({ where: { id: o.id }, data: { status: 'PAID' } });
    await tx.subOrder.updateMany({ where: { orderId: o.id }, data: { status: 'CONFIRMED' } });
    this.queue.notify({ type: 'ORDER_CONFIRMED', orderId: o.id });
    return 'ok';
  }

  /** Releases stock (and coupon uses) held by orders that were never paid. Runs before each checkout. */
  async expireStale() {
    const minutes = await this.platform.getSetting<number>('marketplace.paymentHoldMinutes');
    const stale = await this.prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', createdAt: { lt: new Date(Date.now() - minutes * 60_000) } }, select: { id: true, couponId: true } });
    for (const o of stale) {
      await this.prisma.$transaction(async (tx) => {
        const n = await tx.order.updateMany({ where: { id: o.id, status: 'PENDING_PAYMENT' }, data: { status: 'EXPIRED' } });
        if (!n.count) return; // paid meanwhile
        const subs = await tx.subOrder.findMany({ where: { orderId: o.id }, select: { id: true } });
        for (const s of subs) await restock(tx, s.id);
        await tx.subOrder.updateMany({ where: { orderId: o.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'SYSTEM', cancelReason: 'Payment not completed' } });
        if (o.couponId) await tx.coupon.update({ where: { id: o.couponId }, data: { usedCount: { decrement: 1 } } });
      });
    }
    return stale.length;
  }

  // ══════════════ customer orders ══════════════

  async customerOrders(userId: string, q: { skip: number; limit: number; page: number }) {
    const where = { userId, status: { not: 'EXPIRED' as const } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit, include: { subOrders: { include: { items: true, vendor: { select: { businessName: true } } } } } }),
      this.prisma.order.count({ where }),
    ]);
    return Paged.of(
      items.map((o) => ({ id: o.id, code: o.code, status: o.status, totalPaise: o.totalPaise, createdAt: o.createdAt, units: o.subOrders.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0), parcels: o.subOrders.map((s) => ({ code: s.code, status: s.status, vendor: s.vendor.businessName })) })),
      total, q,
    );
  }

  async customerOrder(userId: string, id: string) {
    const o = await this.prisma.order.findFirst({
      where: { id, userId },
      include: { payment: true, subOrders: { include: { items: { include: { variant: { select: { productId: true, product: { select: { slug: true } } } } } }, vendor: { select: { id: true, businessName: true } }, returns: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'asc' } } },
    });
    if (!o) throw new NotFoundException('Order not found.');
    const productIds = [...new Set(o.subOrders.flatMap((s) => s.items.map((i) => i.variant?.productId)).filter((x): x is string => !!x))];
    const reviewed = await this.reviews.ratingsFor(userId, productIds);
    const refunds = o.paymentId ? await this.prisma.refund.findMany({ where: { paymentId: o.paymentId } }) : [];
    const windowDays = await this.platform.getSetting<number>('marketplace.returnWindowDays');
    const now = new Date();
    return {
      id: o.id, code: o.code, status: o.status, createdAt: o.createdAt, shipTo: o.shipTo,
      itemsPaise: o.itemsPaise, discountPaise: o.discountPaise, shippingPaise: o.shippingPaise, totalPaise: o.totalPaise,
      payment: o.status === 'PENDING_PAYMENT' && o.payment ? this.payments.checkoutParams(o.payment) : null,
      refunds: refunds.map((r) => ({ amountPaise: r.amountPaise, reason: r.reason, status: r.status, createdAt: r.createdAt })),
      parcels: o.subOrders.map((s) => ({
        id: s.id, code: s.code, status: s.status, vendor: s.vendor, itemsPaise: s.itemsPaise, discountPaise: s.discountPaise, shippingPaise: s.shippingPaise, totalPaise: s.totalPaise,
        courier: s.courier, trackingNumber: s.trackingNumber, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, cancelReason: s.cancelReason, cancelledBy: s.cancelledBy,
        // A product can be reviewed once the parcel arrived (and while it's still listed somewhere we know).
        items: s.items.map((i) => {
          const productId = i.variant?.productId ?? null;
          const review = productId ? reviewed.get(productId) ?? null : null;
          return {
            productTitle: i.productTitle, variantTitle: i.variantTitle, qty: i.qty, unitPricePaise: i.unitPricePaise, lineTotalPaise: i.lineTotalPaise,
            productId, productSlug: i.variant?.product.slug ?? null, review,
            canReview: !!productId && !review && parcelReceived(s.status, s.deliveredAt),
          };
        }),
        canCancel: s.status === 'CONFIRMED',
        canReturn: s.status === 'DELIVERED' && returnWindowOpen(s.deliveredAt, now, windowDays),
        returnRequest: s.returns[0] ? { id: s.returns[0].id, status: s.returns[0].status, reason: s.returns[0].reason, note: s.returns[0].note, refundPaise: s.returns[0].refundPaise } : null,
      })),
    };
  }

  /** Customers can cancel a parcel until the vendor packs it; that parcel is refunded in full. */
  async customerCancel(userId: string, subOrderId: string, reason: string) {
    const s = await this.prisma.subOrder.findFirst({ where: { id: subOrderId, order: { userId } }, include: { order: true } });
    if (!s) throw new NotFoundException('Order not found.');
    if (s.status !== 'CONFIRMED') throw new BadRequestException(s.status === 'PACKED' ? 'The seller has already packed this. Contact support, or return it after delivery.' : 'This can’t be cancelled now.');
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.subOrder.updateMany({ where: { id: s.id, status: 'CONFIRMED' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'CUSTOMER', cancelReason: reason } });
      if (!n.count) throw new ConflictException('The seller just packed this order. Refresh and try again.');
      await restock(tx, s.id);
      await this.finance.oweRefund(tx, { paymentId: s.order.paymentId, amountPaise: s.totalPaise, reason: 'SUB_ORDER_CANCELLED', reference: `SubOrder:${s.id}` });
      await this.vendors.completeOrderIfDone(tx, s.orderId);
      await this.audit.log({ actorId: userId, action: 'sub_order.cancel', entityType: 'SubOrder', entityId: s.id, after: { by: 'CUSTOMER', reason, refundPaise: s.totalPaise } }, tx);
    });
    this.queue.notify({ type: 'ORDER_UPDATE', subOrderId: s.id, to: 'vendor' });
    return this.customerOrder(userId, s.orderId);
  }

  /** Within the return window after delivery. The refund is the parcel's item value after discount (shipping isn't refunded). */
  async requestReturn(userId: string, subOrderId: string, reason: string) {
    const s = await this.prisma.subOrder.findFirst({ where: { id: subOrderId, order: { userId } } });
    if (!s) throw new NotFoundException('Order not found.');
    const days = await this.platform.getSetting<number>('marketplace.returnWindowDays');
    if (s.status !== 'DELIVERED') throw new BadRequestException('Only delivered orders can be returned.');
    if (!returnWindowOpen(s.deliveredAt, new Date(), days)) throw new BadRequestException(`Returns close ${days} days after delivery.`);
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.subOrder.updateMany({ where: { id: s.id, status: 'DELIVERED' }, data: { status: 'RETURN_REQUESTED' } });
      if (!n.count) throw new ConflictException('A return is already in progress.');
      await tx.returnRequest.create({ data: { subOrderId: s.id, userId, reason, refundPaise: s.itemsPaise - s.discountPaise } });
      await this.audit.log({ actorId: userId, action: 'return.request', entityType: 'SubOrder', entityId: s.id, after: { reason } }, tx);
    });
    this.queue.notify({ type: 'ORDER_UPDATE', subOrderId: s.id, to: 'vendor' });
    return this.customerOrder(userId, s.orderId);
  }

  // ══════════════ admin ══════════════

  adminCategories() {
    return this.prisma.productCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: true } } } });
  }

  async saveCategory(actorId: string, dto: ProductCategoryDto, id?: string) {
    if (dto.parentId) {
      const parent = await this.prisma.productCategory.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.parentId) throw new BadRequestException('Categories can be nested one level deep.');
      if (parent.id === id) throw new BadRequestException('A category can’t be its own parent.');
    }
    const c = id ? await this.prisma.productCategory.update({ where: { id }, data: dto }) : await this.prisma.productCategory.create({ data: dto });
    await this.audit.log({ actorId, action: id ? 'product_category.update' : 'product_category.create', entityType: 'ProductCategory', entityId: c.id, after: dto });
    return c;
  }

  async adminProducts(q: AdminProductsQuery) {
    const where: Prisma.ProductWhereInput = { status: q.status, vendorId: q.vendorId, ...(q.q ? { title: { contains: likeText(q.q), mode: 'insensitive' } } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: q.skip, take: q.limit, include: { vendor: { select: { id: true, businessName: true } }, category: { select: { name: true } }, variants: true } }),
      this.prisma.product.count({ where }),
    ]);
    return Paged.of(items, total, q);
  }

  async blockProduct(actorId: string, id: string, blocked: boolean, reason?: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found.');
    if (blocked && !reason) throw new BadRequestException('Give a reason. The vendor will see it.');
    await this.prisma.product.update({ where: { id }, data: blocked ? { status: 'BLOCKED', blockReason: reason } : { status: 'INACTIVE', blockReason: null } });
    await this.audit.log({ actorId, action: blocked ? 'product.block' : 'product.unblock', entityType: 'Product', entityId: id, before: { status: p.status }, after: { reason } });
    return { id, status: blocked ? 'BLOCKED' : 'INACTIVE' };
  }

  async adminOrders(q: AdminOrdersQuery) {
    const where: Prisma.SubOrderWhereInput = { status: q.status ?? { not: 'PENDING_PAYMENT' }, vendorId: q.vendorId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit, include: { vendor: { select: { id: true, businessName: true } }, order: { select: { code: true, user: { select: { id: true, name: true } } } }, items: true } }),
      this.prisma.subOrder.count({ where }),
    ]);
    return Paged.of(items, total, q);
  }

  // ── seller coupons (vendor-funded, scoped to the seller's own items) ──

  private async approvedVendor(userId: string) {
    const v = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!v) throw new NotFoundException('Set up your store first.');
    if (v.status !== 'APPROVED') throw new BadRequestException('Your store isn’t approved yet.');
    return v;
  }

  async vendorCoupons(userId: string) {
    const v = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!v) throw new NotFoundException('Set up your store first.');
    return this.prisma.coupon.findMany({ where: { vendorId: v.id }, orderBy: { createdAt: 'desc' } });
  }

  async createVendorCoupon(userId: string, dto: VendorCouponDto) {
    const v = await this.approvedVendor(userId);
    return this.saveCoupon(userId, { ...dto, vendorId: v.id });
  }

  /** Sellers can change only their own coupons, and never move one to another seller. */
  async updateVendorCoupon(userId: string, id: string, dto: UpdateVendorCouponDto) {
    const v = await this.approvedVendor(userId);
    const c = await this.prisma.coupon.findFirst({ where: { id, vendorId: v.id } });
    if (!c) throw new NotFoundException('Coupon not found.');
    return this.saveCoupon(userId, dto, c.id);
  }

  coupons() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, include: { vendor: { select: { id: true, businessName: true } } } });
  }

  async saveCoupon(actorId: string, dto: CouponDto | UpdateCouponDto, id?: string) {
    // Check the coupon as it will be after this change: a partial edit is merged with what's stored.
    const before = id ? await this.prisma.coupon.findUnique({ where: { id } }) : null;
    if (id && !before) throw new NotFoundException('Coupon not found.');
    const kind = dto.kind ?? before?.kind;
    const value = dto.value ?? before?.value;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : before?.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : before?.endsAt;
    if (kind === 'PERCENT' && value !== undefined && value > 10_000) throw new BadRequestException('A percentage coupon can’t exceed 100%.');
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('The coupon must end after it starts.');
    const data = { ...dto, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined };
    try {
      const c = id ? await this.prisma.coupon.update({ where: { id }, data }) : await this.prisma.coupon.create({ data: data as Prisma.CouponUncheckedCreateInput });
      await this.audit.log({ actorId, action: id ? 'coupon.update' : 'coupon.create', entityType: 'Coupon', entityId: c.id, after: dto });
      return c;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A coupon with that code already exists.');
      throw e;
    }
  }
}
