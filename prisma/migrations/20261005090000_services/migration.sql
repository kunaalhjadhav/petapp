-- Raw: extensions (PostGIS for nearby search; btree_gist for the booking exclusion constraint)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'DOCUMENT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PARTNER_STATUS';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_COMPLETED';

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PartnerDocKind" AS ENUM ('ID_PROOF', 'ADDRESS_PROOF', 'BUSINESS_REGISTRATION', 'GST_CERTIFICATE', 'PROFESSIONAL_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('AT_CENTER', 'AT_HOME');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED');

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "commissionBps" INTEGER NOT NULL DEFAULT 1500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePartner" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "about" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "addressLine" TEXT NOT NULL,
    "area" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326),
    "homeVisitRadiusKm" INTEGER NOT NULL DEFAULT 0,
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "slotStepMin" INTEGER NOT NULL DEFAULT 30,
    "gstin" TEXT,
    "commissionBps" INTEGER,
    "status" "PartnerStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ServicePartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerDocument" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "kind" "PartnerDocKind" NOT NULL,
    "mediaId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "PartnerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerService" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "bufferMin" INTEGER NOT NULL DEFAULT 0,
    "pricePaise" INTEGER NOT NULL,
    "modes" "ServiceMode"[],
    "speciesIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "PartnerService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerHours" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opensMin" INTEGER NOT NULL,
    "closesMin" INTEGER NOT NULL,

CONSTRAINT "PartnerHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerTimeOff" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

CONSTRAINT "PartnerTimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "petId" UUID NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "mode" "ServiceMode" NOT NULL,
    "address" JSONB,
    "pricePaise" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "platformFeePaise" INTEGER NOT NULL,
    "partnerEarningPaise" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentId" UUID,
    "customerNote" TEXT,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "refundPaise" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceReview" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ServiceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_key_key" ON "ServiceCategory"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePartner_userId_key" ON "ServicePartner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePartner_slug_key" ON "ServicePartner"("slug");

-- CreateIndex
CREATE INDEX "ServicePartner_status_city_idx" ON "ServicePartner"("status", "city");

-- CreateIndex
CREATE INDEX "ServicePartner_location_idx" ON "ServicePartner" USING GIST ("location");

-- CreateIndex
CREATE INDEX "PartnerDocument_partnerId_idx" ON "PartnerDocument"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerService_partnerId_isActive_idx" ON "PartnerService"("partnerId", "isActive");

-- CreateIndex
CREATE INDEX "PartnerService_categoryId_idx" ON "PartnerService"("categoryId");

-- CreateIndex
CREATE INDEX "PartnerHours_partnerId_weekday_idx" ON "PartnerHours"("partnerId", "weekday");

-- CreateIndex
CREATE INDEX "PartnerTimeOff_partnerId_startsAt_idx" ON "PartnerTimeOff"("partnerId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_code_key" ON "Booking"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_paymentId_key" ON "Booking"("paymentId");

-- CreateIndex
CREATE INDEX "Booking_partnerId_startsAt_idx" ON "Booking"("partnerId", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_customerId_startsAt_idx" ON "Booking"("customerId", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_status_createdAt_idx" ON "Booking"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceReview_bookingId_key" ON "ServiceReview"("bookingId");

-- CreateIndex
CREATE INDEX "ServiceReview_partnerId_createdAt_idx" ON "ServiceReview"("partnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServicePartner" ADD CONSTRAINT "ServicePartner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerDocument" ADD CONSTRAINT "PartnerDocument_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ServicePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerDocument" ADD CONSTRAINT "PartnerDocument_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerService" ADD CONSTRAINT "PartnerService_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ServicePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerService" ADD CONSTRAINT "PartnerService_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerHours" ADD CONSTRAINT "PartnerHours_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ServicePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerTimeOff" ADD CONSTRAINT "PartnerTimeOff_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ServicePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ServicePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "PartnerService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReview" ADD CONSTRAINT "ServiceReview_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReview" ADD CONSTRAINT "ServiceReview_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ServicePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReview" ADD CONSTRAINT "ServiceReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw: keep ServicePartner.location in step with lat/lng (Prisma can't write geography values)
CREATE OR REPLACE FUNCTION service_partner_location() RETURNS trigger AS $$
BEGIN
  NEW."location" := ST_SetSRID(ST_MakePoint(NEW."lng", NEW."lat"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_partner_location
BEFORE INSERT OR UPDATE OF "lat", "lng" ON "ServicePartner"
FOR EACH ROW EXECUTE FUNCTION service_partner_location();

-- Raw: two active bookings can never overlap on the same partner staff slot.
-- Unpaid bookings are moved to EXPIRED by the application before they stop holding a slot.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_overlap"
EXCLUDE USING gist ("partnerId" WITH =, "slotIndex" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
WHERE ("status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'));
