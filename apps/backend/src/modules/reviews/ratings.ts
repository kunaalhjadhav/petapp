import { BadRequestException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { REVIEW_PHOTO_MAX, roundRating } from './reviews.rules';

type Tx = Prisma.TransactionClient;

// Ratings always equal the average of visible reviews. These run inside the transaction that changes a review,
// so a hidden review stops counting at the same moment it disappears.

export async function recomputePartnerRating(tx: Tx, partnerId: string) {
  const agg = await tx.serviceReview.aggregate({ where: { partnerId, status: 'VISIBLE' }, _avg: { rating: true }, _count: { _all: true } });
  await tx.servicePartner.update({ where: { id: partnerId }, data: { ratingAvg: roundRating(agg._avg.rating), ratingCount: agg._count._all } });
}

/** The product's rating, and the seller's across all their products. */
export async function recomputeProductRating(tx: Tx, productId: string) {
  const p = await tx.product.findUnique({ where: { id: productId }, select: { vendorId: true } });
  if (!p) return;
  const [prod, vendor] = await Promise.all([
    tx.productReview.aggregate({ where: { productId, status: 'VISIBLE' }, _avg: { rating: true }, _count: { _all: true } }),
    tx.productReview.aggregate({ where: { vendorId: p.vendorId, status: 'VISIBLE' }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  await tx.product.update({ where: { id: productId }, data: { ratingAvg: roundRating(prod._avg.rating), ratingCount: prod._count._all } });
  await tx.vendor.update({ where: { id: p.vendorId }, data: { ratingAvg: roundRating(vendor._avg.rating), ratingCount: vendor._count._all } });
}

/** Review photos are public: the person's own finished, non-private photo uploads. */
export async function assertReviewPhotos(db: Pick<PrismaClient, 'mediaAsset'>, userId: string, ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length > REVIEW_PHOTO_MAX) throw new BadRequestException(`Add up to ${REVIEW_PHOTO_MAX} photos.`);
  if (!unique.length) return [];
  const ok = await db.mediaAsset.count({ where: { id: { in: unique }, ownerId: userId, kind: 'IMAGE', status: 'READY', private: false } });
  if (ok !== unique.length) throw new BadRequestException('Every photo must be one of your finished photo uploads.');
  return unique;
}
