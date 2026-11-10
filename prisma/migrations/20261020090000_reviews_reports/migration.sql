-- Phase 9b: product reviews (verified purchases), photos on reviews, and reporting for every kind of content

ALTER TYPE "ReportTarget" ADD VALUE 'SERVICE_PARTNER';
ALTER TYPE "ReportTarget" ADD VALUE 'PRODUCT_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_REPLY';

ALTER TABLE "Report" ADD COLUMN "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ServiceReview" ADD COLUMN "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
                      ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProductReview" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "subOrderId" UUID NOT NULL,
    "variantTitle" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductReview_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "ProductReview_status_check" CHECK ("status" IN ('VISIBLE', 'HIDDEN'))
);

CREATE UNIQUE INDEX "ProductReview_customerId_productId_key" ON "ProductReview"("customerId", "productId");
CREATE INDEX "ProductReview_productId_status_createdAt_idx" ON "ProductReview"("productId", "status", "createdAt");
CREATE INDEX "ProductReview_vendorId_createdAt_idx" ON "ProductReview"("vendorId", "createdAt");

ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "SubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Service ratings stay 1–5 too (the API always checked; now the database does).
ALTER TABLE "ServiceReview" ADD CONSTRAINT "ServiceReview_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
