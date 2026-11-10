import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MediaService, type MediaView } from '../media/media.service';
import { QueueService } from '../../queue/queue.service';
import { Paged } from '../../common/dto/pagination.dto';
import { likeText } from '../../common/utils/search';
import { Prisma } from '../../generated/prisma/client';
import type { AdminReviewsQuery, BusinessReviewsQuery, ProductReviewDto, ReviewsQuery } from './reviews.dto';
import { assertReviewPhotos, recomputePartnerRating, recomputeProductRating } from './ratings';
import { needsAiCheck, parcelReceived, RECEIVED_PARCEL, ratingSummary, reviewerName, reviewOrder, type RatingSummary } from './reviews.rules';

const LIVE_PRODUCT: Prisma.ProductWhereInput = { status: 'ACTIVE', vendor: { status: 'APPROVED' } };
const isUuid = (s: string) => /^[0-9a-f-]{36}$/.test(s);

interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  photoIds: string[];
  reply: string | null;
  repliedAt: Date | null;
  status: string;
  createdAt: Date;
  variantTitle?: string | null;
  customer: { name: string | null };
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  photos: MediaView[];
  reply: string | null;
  repliedAt: Date | null;
  by: string;
  at: Date;
  /** Every review comes from a delivered order or a completed booking. */
  verified: true;
  variantTitle: string | null;
}

/**
 * Reviews and ratings (spec §38): product reviews from verified purchases, service reviews from completed bookings
 * (written in BookingsService), replies from the business, and moderation.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  // ══════════════ views ══════════════

  /** Photo views for many reviews in one query; photos that were rejected or deleted are left out. */
  private async photoMap(rows: Array<{ photoIds: string[] }>): Promise<Map<string, MediaView>> {
    const ids = [...new Set(rows.flatMap((r) => r.photoIds))];
    if (!ids.length) return new Map();
    const assets = await this.prisma.mediaAsset.findMany({ where: { id: { in: ids }, status: 'READY' } });
    return new Map(await Promise.all(assets.map(async (a) => [a.id, await this.media.view(a)] as const)));
  }

  async views(rows: ReviewRow[]): Promise<PublicReview[]> {
    const photos = await this.photoMap(rows);
    return rows.map((r) => ({
      id: r.id, rating: r.rating, comment: r.comment, reply: r.reply, repliedAt: r.repliedAt, by: reviewerName(r.customer.name), at: r.createdAt,
      photos: r.photoIds.map((id) => photos.get(id)).filter((v): v is MediaView => !!v),
      verified: true as const, variantTitle: r.variantTitle ?? null,
    }));
  }

  private filters(q: ReviewsQuery) {
    return {
      ...(q.stars ? { rating: q.stars } : {}),
      ...(q.photos ? { photoIds: { isEmpty: false } } : {}),
    };
  }

  async productSummary(productId: string): Promise<RatingSummary> {
    const rows = await this.prisma.productReview.groupBy({ by: ['rating'], where: { productId, status: 'VISIBLE' }, _count: { _all: true } });
    return ratingSummary(rows.map((r) => ({ rating: r.rating, count: r._count._all })));
  }

  async partnerSummary(partnerId: string): Promise<RatingSummary> {
    const rows = await this.prisma.serviceReview.groupBy({ by: ['rating'], where: { partnerId, status: 'VISIBLE' }, _count: { _all: true } });
    return ratingSummary(rows.map((r) => ({ rating: r.rating, count: r._count._all })));
  }

  /** For the product page: the breakdown and the latest few. */
  async productBlock(productId: string, take = 3) {
    const [summary, rows] = await Promise.all([
      this.productSummary(productId),
      this.prisma.productReview.findMany({ where: { productId, status: 'VISIBLE' }, orderBy: { createdAt: 'desc' }, take, include: { customer: { select: { name: true } } } }),
    ]);
    return { summary, recent: await this.views(rows) };
  }

  /** For the partner page. */
  async partnerBlock(partnerId: string, take = 5) {
    const [summary, rows] = await Promise.all([
      this.partnerSummary(partnerId),
      this.prisma.serviceReview.findMany({ where: { partnerId, status: 'VISIBLE' }, orderBy: { createdAt: 'desc' }, take, include: { customer: { select: { name: true } } } }),
    ]);
    return { summary, recent: await this.views(rows) };
  }

  // ══════════════ public lists ══════════════

  async productReviews(idOrSlug: string, q: ReviewsQuery) {
    const p = await this.prisma.product.findFirst({ where: { ...LIVE_PRODUCT, OR: [{ slug: idOrSlug }, ...(isUuid(idOrSlug) ? [{ id: idOrSlug }] : [])] }, select: { id: true } });
    if (!p) throw new NotFoundException('Product not found.');
    const where: Prisma.ProductReviewWhereInput = { productId: p.id, status: 'VISIBLE', ...this.filters(q) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({ where, orderBy: reviewOrder(q.sort), skip: q.skip, take: q.limit, include: { customer: { select: { name: true } } } }),
      this.prisma.productReview.count({ where }),
    ]);
    return Paged.of(await this.views(rows), total, q);
  }

  async partnerReviews(partnerId: string, q: ReviewsQuery) {
    const where: Prisma.ServiceReviewWhereInput = { partnerId, status: 'VISIBLE', ...this.filters(q) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceReview.findMany({ where, orderBy: reviewOrder(q.sort), skip: q.skip, take: q.limit, include: { customer: { select: { name: true } } } }),
      this.prisma.serviceReview.count({ where }),
    ]);
    return Paged.of(await this.views(rows), total, q);
  }

  // ══════════════ writing ══════════════

  /**
   * A product review needs a parcel with this product that reached the customer. One review per person per
   * product, however many times they bought it; the latest received parcel is kept as the proof.
   */
  async writeProductReview(customerId: string, productId: string, dto: ProductReviewDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, vendorId: true } });
    if (!product) throw new NotFoundException('Product not found.');
    const parcel = await this.prisma.subOrder.findFirst({
      where: { order: { userId: customerId }, status: { in: [...RECEIVED_PARCEL] }, deliveredAt: { not: null }, items: { some: { variant: { productId } } } },
      orderBy: { deliveredAt: 'desc' },
      include: { items: { where: { variant: { productId } }, take: 1 } },
    });
    if (!parcel) throw new BadRequestException('You can review a product once it’s been delivered to you.');
    const photoIds = await assertReviewPhotos(this.prisma, customerId, dto.photoIds);
    let id = '';
    try {
      await this.prisma.$transaction(async (tx) => {
        ({ id } = await tx.productReview.create({
          data: {
            productId, vendorId: product.vendorId, customerId, subOrderId: parcel.id, variantTitle: parcel.items[0]?.variantTitle ?? null,
            rating: dto.rating, comment: dto.comment || null, photoIds,
          },
        }));
        await recomputeProductRating(tx, productId);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You’ve already reviewed this product.');
      throw e;
    }
    if (needsAiCheck(dto.comment, photoIds)) this.queue.assess('PRODUCT_REVIEW', id);
    this.queue.notify({ type: 'REVIEW_RECEIVED', kind: 'PRODUCT', reviewId: id });
    return this.mine(customerId, productId);
  }

  /** The customer's own review of a product, whatever its status (so they can see it was hidden). */
  async mine(customerId: string, productId: string) {
    const r = await this.prisma.productReview.findUnique({ where: { customerId_productId: { customerId, productId } }, include: { customer: { select: { name: true } } } });
    if (!r) throw new NotFoundException('You haven’t reviewed this product.');
    const [view] = await this.views([r]);
    return { ...view, status: r.status, productId: r.productId };
  }

  /** For order screens: the customer's reviews of these products. */
  async ratingsFor(customerId: string, productIds: string[]): Promise<Map<string, { id: string; rating: number; status: string }>> {
    if (!productIds.length) return new Map();
    const rows = await this.prisma.productReview.findMany({ where: { customerId, productId: { in: productIds } }, select: { id: true, productId: true, rating: true, status: true } });
    return new Map(rows.map((r) => [r.productId, { id: r.id, rating: r.rating, status: r.status }]));
  }

  // ══════════════ the business's side ══════════════

  private async vendorOf(userId: string) {
    const v = await this.prisma.vendor.findUnique({ where: { userId }, select: { id: true, businessName: true, ratingAvg: true, ratingCount: true } });
    if (!v) throw new NotFoundException('Set up your store first.');
    return v;
  }

  private async partnerOf(userId: string) {
    const p = await this.prisma.servicePartner.findUnique({ where: { userId }, select: { id: true, businessName: true, ratingAvg: true, ratingCount: true } });
    if (!p) throw new NotFoundException('Set up your business first.');
    return p;
  }

  /** Every review of the business, hidden ones included (marked), newest first. */
  async businessReviews(userId: string, as: 'vendor' | 'partner', q: BusinessReviewsQuery) {
    const common = { ...this.filters(q), ...(q.unanswered ? { reply: null } : {}) };
    if (as === 'vendor') {
      const v = await this.vendorOf(userId);
      const where: Prisma.ProductReviewWhereInput = { vendorId: v.id, ...common };
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.productReview.findMany({ where, orderBy: reviewOrder(q.sort), skip: q.skip, take: q.limit, include: { customer: { select: { name: true } }, product: { select: { id: true, title: true, slug: true } }, subOrder: { select: { id: true, code: true } } } }),
        this.prisma.productReview.count({ where }),
      ]);
      const views = await this.views(rows);
      return Paged.of(rows.map((r, i) => ({ ...views[i], status: r.status, product: r.product, order: r.subOrder, booking: null })), total, q);
    }
    const p = await this.partnerOf(userId);
    const where: Prisma.ServiceReviewWhereInput = { partnerId: p.id, ...common };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.serviceReview.findMany({ where, orderBy: reviewOrder(q.sort), skip: q.skip, take: q.limit, include: { customer: { select: { name: true } }, booking: { select: { id: true, code: true, startsAt: true, service: { select: { name: true } } } } } }),
      this.prisma.serviceReview.count({ where }),
    ]);
    const views = await this.views(rows);
    return Paged.of(
      rows.map((r, i) => ({ ...views[i], status: r.status, product: null, order: null, booking: { id: r.booking.id, code: r.booking.code, startsAt: r.booking.startsAt, service: r.booking.service.name } })),
      total, q,
    );
  }

  async businessSummary(userId: string, as: 'vendor' | 'partner') {
    if (as === 'vendor') {
      const v = await this.vendorOf(userId);
      const [rows, unanswered] = await Promise.all([
        this.prisma.productReview.groupBy({ by: ['rating'], where: { vendorId: v.id, status: 'VISIBLE' }, _count: { _all: true } }),
        this.prisma.productReview.count({ where: { vendorId: v.id, status: 'VISIBLE', reply: null } }),
      ]);
      return { summary: ratingSummary(rows.map((r) => ({ rating: r.rating, count: r._count._all }))), unanswered };
    }
    const p = await this.partnerOf(userId);
    const [summary, unanswered] = await Promise.all([this.partnerSummary(p.id), this.prisma.serviceReview.count({ where: { partnerId: p.id, status: 'VISIBLE', reply: null } })]);
    return { summary, unanswered };
  }

  /** One public reply per review. Replies can't be edited, like the review itself. */
  async reply(userId: string, as: 'vendor' | 'partner', reviewId: string, reply: string) {
    if (as === 'vendor') {
      const r = await this.prisma.productReview.findUnique({ where: { id: reviewId }, include: { vendor: { select: { userId: true } } } });
      if (!r || r.vendor.userId !== userId) throw new NotFoundException('Review not found.');
      if (r.reply) throw new BadRequestException('You’ve already replied to this review.');
      if (r.status !== 'VISIBLE') throw new BadRequestException('This review is hidden, so it can’t be replied to.');
      await this.prisma.productReview.update({ where: { id: reviewId }, data: { reply, repliedAt: new Date() } });
      this.queue.notify({ type: 'REVIEW_REPLY', kind: 'PRODUCT', reviewId });
    } else {
      const r = await this.prisma.serviceReview.findUnique({ where: { id: reviewId }, include: { partner: { select: { userId: true } } } });
      if (!r || r.partner.userId !== userId) throw new NotFoundException('Review not found.');
      if (r.reply) throw new BadRequestException('You’ve already replied to this review.');
      if (r.status !== 'VISIBLE') throw new BadRequestException('This review is hidden, so it can’t be replied to.');
      await this.prisma.serviceReview.update({ where: { id: reviewId }, data: { reply, repliedAt: new Date() } });
      this.queue.notify({ type: 'REVIEW_REPLY', kind: 'SERVICE', reviewId });
    }
    return { id: reviewId, reply };
  }

  // ══════════════ admin ══════════════

  async adminList(q: AdminReviewsQuery) {
    const text = q.q ? { contains: likeText(q.q), mode: 'insensitive' as const } : undefined;
    const openCases = async (type: 'PRODUCT_REVIEW' | 'SERVICE_REVIEW', ids: string[]) => {
      const cs = await this.prisma.moderationCase.findMany({ where: { targetType: type, targetId: { in: ids }, status: 'OPEN' }, select: { id: true, targetId: true, reportCount: true, aiFlaggedAt: true } });
      return new Map(cs.map((c) => [c.targetId, { id: c.id, reports: c.reportCount, aiFlagged: !!c.aiFlaggedAt }]));
    };
    if (q.kind === 'SERVICE') {
      const where: Prisma.ServiceReviewWhereInput = {
        status: q.status, partnerId: q.partnerId, ...(q.stars ? { rating: q.stars } : {}),
        ...(text ? { OR: [{ comment: text }, { reply: text }, { partner: { businessName: text } }, { customer: { name: text } }] } : {}),
      };
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.serviceReview.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit, include: { customer: { select: { id: true, name: true } }, partner: { select: { id: true, businessName: true } }, booking: { select: { id: true, code: true } } } }),
        this.prisma.serviceReview.count({ where }),
      ]);
      const [photos, cases] = await Promise.all([this.photoMap(rows), openCases('SERVICE_REVIEW', rows.map((r) => r.id))]);
      return Paged.of(rows.map((r) => ({
        id: r.id, kind: 'SERVICE' as const, rating: r.rating, comment: r.comment, reply: r.reply, repliedAt: r.repliedAt, status: r.status, createdAt: r.createdAt,
        photos: r.photoIds.map((id) => photos.get(id)).filter(Boolean), customer: r.customer,
        business: { id: r.partner.id, name: r.partner.businessName }, subject: { id: r.booking.id, label: `Booking ${r.booking.code}` }, openCase: cases.get(r.id) ?? null,
      })), total, q);
    }
    const where: Prisma.ProductReviewWhereInput = {
      status: q.status, vendorId: q.vendorId, productId: q.productId, ...(q.stars ? { rating: q.stars } : {}),
      ...(text ? { OR: [{ comment: text }, { reply: text }, { product: { title: text } }, { vendor: { businessName: text } }, { customer: { name: text } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.limit, include: { customer: { select: { id: true, name: true } }, vendor: { select: { id: true, businessName: true } }, product: { select: { id: true, title: true } } } }),
      this.prisma.productReview.count({ where }),
    ]);
    const [photos, cases] = await Promise.all([this.photoMap(rows), openCases('PRODUCT_REVIEW', rows.map((r) => r.id))]);
    return Paged.of(rows.map((r) => ({
      id: r.id, kind: 'PRODUCT' as const, rating: r.rating, comment: r.comment, reply: r.reply, repliedAt: r.repliedAt, status: r.status, createdAt: r.createdAt,
      photos: r.photoIds.map((id) => photos.get(id)).filter(Boolean), customer: r.customer,
      business: { id: r.vendor.id, name: r.vendor.businessName }, subject: { id: r.product.id, label: r.product.title }, openCase: cases.get(r.id) ?? null,
    })), total, q);
  }

  /** Hide or restore a review. The rating follows straight away. */
  async setStatus(actorId: string, kind: 'PRODUCT' | 'SERVICE', id: string, status: 'VISIBLE' | 'HIDDEN', note?: string) {
    const r = kind === 'PRODUCT'
      ? await this.prisma.productReview.findUnique({ where: { id }, select: { status: true, productId: true } })
      : await this.prisma.serviceReview.findUnique({ where: { id }, select: { status: true, partnerId: true } });
    if (!r) throw new NotFoundException('Review not found.');
    if (r.status === status) return { id, status };
    await this.prisma.$transaction(async (tx) => {
      if (kind === 'PRODUCT') {
        await tx.productReview.update({ where: { id }, data: { status } });
        await recomputeProductRating(tx, (r as { productId: string }).productId);
      } else {
        await tx.serviceReview.update({ where: { id }, data: { status } });
        await recomputePartnerRating(tx, (r as { partnerId: string }).partnerId);
      }
      await this.audit.log(
        { actorId, action: kind === 'PRODUCT' ? 'product_review.status' : 'service_review.status', entityType: kind === 'PRODUCT' ? 'ProductReview' : 'ServiceReview', entityId: id, before: { status: r.status }, after: { status, note: note ?? null } },
        tx,
      );
    });
    return { id, status };
  }

  /** Used by order screens: was this parcel received, so its products can be reviewed? */
  static received(status: string, deliveredAt: Date | null) {
    return parcelReceived(status, deliveredAt);
  }
}
