-- Phase 9d: admin analytics (spec §55), membership plans (spec §40, off by default), reminders and promotions (spec §36).

-- Notification types and preferences
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'CONTEST_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'CONTEST_VOTES';
ALTER TYPE "NotificationType" ADD VALUE 'MEMBERSHIP_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'PROMOTION';

ALTER TABLE "NotificationPreference"
  ADD COLUMN "reminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "votes" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "promotions" BOOLEAN NOT NULL DEFAULT false;

-- Members-only switches, and booking reminders
ALTER TABLE "Contest" ADD COLUMN "membersOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Challenge" ADD COLUMN "membersOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Coupon" ADD COLUMN "membersOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "remindedAt" TIMESTAMP(3);

-- Activity and reel statistics
CREATE TABLE "UserActivity" (
    "day" DATE NOT NULL,
    "userId" UUID NOT NULL,
    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("day","userId")
);
CREATE INDEX "UserActivity_userId_idx" ON "UserActivity"("userId");
ALTER TABLE "UserActivity" ADD CONSTRAINT "UserActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PostDailyStat" (
    "postId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PostDailyStat_pkey" PRIMARY KEY ("postId","day")
);
CREATE INDEX "PostDailyStat_day_idx" ON "PostDailyStat"("day");
ALTER TABLE "PostDailyStat" ADD CONSTRAINT "PostDailyStat_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Memberships
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TABLE "MembershipPlan" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "pricePaise" INTEGER NOT NULL DEFAULT 0,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "exclusiveContests" BOOLEAN NOT NULL DEFAULT false,
    "premiumChallenges" BOOLEAN NOT NULL DEFAULT false,
    "memberDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "priorityDays" INTEGER NOT NULL DEFAULT 0,
    "badge" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MembershipPlan_price_check" CHECK ("pricePaise" >= 0 AND "periodDays" > 0 AND "priorityDays" >= 0)
);
CREATE UNIQUE INDEX "MembershipPlan_key_key" ON "MembershipPlan"("key");

CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "pricePaise" INTEGER NOT NULL,
    "paymentId" UUID,
    "source" TEXT NOT NULL DEFAULT 'PURCHASE',
    "grantedById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Membership_paymentId_key" ON "Membership"("paymentId");
CREATE INDEX "Membership_userId_status_endsAt_idx" ON "Membership"("userId", "status", "endsAt");
CREATE INDEX "Membership_planId_status_idx" ON "Membership"("planId", "status");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Promotions
CREATE TYPE "PromotionAudience" AS ENUM ('ALL', 'MEMBERS', 'CITY');
CREATE TYPE "PromotionStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'CANCELLED');

CREATE TABLE "Promotion" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "audience" "PromotionAudience" NOT NULL DEFAULT 'ALL',
    "city" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'QUEUED',
    "sendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Promotion_status_sendAt_idx" ON "Promotion"("status", "sendAt");
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
