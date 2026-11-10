-- Phase 7b: recommendations and admin-controlled home sections

CREATE TYPE "HomeSectionKind" AS ENUM ('FEATURED_REELS', 'TRENDING_PETS', 'ACTIVE_CONTESTS', 'CHALLENGES', 'NEARBY_SERVICES', 'RECOMMENDED_PRODUCTS', 'PARTNER_OFFERS', 'UPCOMING_EVENTS');
CREATE TYPE "InterestKind" AS ENUM ('PRODUCT_VIEW', 'SERVICE_VIEW', 'CONTEST_VIEW');

CREATE TABLE "HomeSection" (
    "id" UUID NOT NULL,
    "kind" "HomeSectionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "speciesIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "itemLimit" INTEGER NOT NULL DEFAULT 10,
    "pinnedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HomeSection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomeSection_itemLimit_range" CHECK ("itemLimit" BETWEEN 1 AND 20),
    CONSTRAINT "HomeSection_schedule" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt")
);
CREATE INDEX "HomeSection_isActive_position_idx" ON "HomeSection"("isActive", "position");

CREATE TABLE "InterestEvent" (
    "userId" UUID NOT NULL,
    "kind" "InterestKind" NOT NULL,
    "targetId" UUID NOT NULL,
    "categoryId" UUID,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterestEvent_pkey" PRIMARY KEY ("userId", "kind", "targetId", "day")
);
CREATE INDEX "InterestEvent_userId_createdAt_idx" ON "InterestEvent"("userId", "createdAt");
CREATE INDEX "InterestEvent_createdAt_idx" ON "InterestEvent"("createdAt");
ALTER TABLE "InterestEvent" ADD CONSTRAINT "InterestEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecoDismissal" (
    "userId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoDismissal_pkey" PRIMARY KEY ("userId", "targetType", "targetId")
);
ALTER TABLE "RecoDismissal" ADD CONSTRAINT "RecoDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The spec's default home screen. Admins can reorder, rename, schedule, target or switch off each one.
INSERT INTO "HomeSection" ("id", "kind", "title", "subtitle", "position", "updatedAt") VALUES
  (gen_random_uuid(), 'FEATURED_REELS', 'Featured reels', NULL, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TRENDING_PETS', 'Trending pets', 'Most loved this week', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ACTIVE_CONTESTS', 'Contests', 'Open for entries', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHALLENGES', 'Challenges', NULL, 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'NEARBY_SERVICES', 'Pet services near you', NULL, 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RECOMMENDED_PRODUCTS', 'Picked for your pets', NULL, 6, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PARTNER_OFFERS', 'Partner offers', NULL, 7, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'UPCOMING_EVENTS', 'Coming up', NULL, 8, CURRENT_TIMESTAMP);
