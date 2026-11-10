-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CONTEST_ENTRY_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTEST_VOTING_OPEN';
ALTER TYPE "NotificationType" ADD VALUE 'CONTEST_RESULT';
ALTER TYPE "NotificationType" ADD VALUE 'CHALLENGE_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'BADGE_EARNED';

-- CreateEnum
CREATE TYPE "ChallengeKind" AS ENUM ('FREE', 'PAID', 'CONTEST_LINKED');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckInProof" AS ENUM ('NONE', 'POST', 'TEXT');

-- CreateEnum
CREATE TYPE "ChallengeEntryStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "Badge" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "userId" UUID NOT NULL,
    "badgeId" UUID NOT NULL,
    "source" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("userId","badgeId")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "kind" "ChallengeKind" NOT NULL DEFAULT 'FREE',
    "feePaise" INTEGER NOT NULL DEFAULT 0,
    "contestId" UUID,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "requiredCheckIns" INTEGER NOT NULL,
    "proof" "CheckInProof" NOT NULL DEFAULT 'NONE',
    "pointsPerCheckIn" INTEGER NOT NULL DEFAULT 10,
    "streakBonusEvery" INTEGER NOT NULL DEFAULT 0,
    "streakBonusPoints" INTEGER NOT NULL DEFAULT 0,
    "badgeId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeParticipant" (
    "id" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "petId" UUID,
    "status" "ChallengeEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "paymentId" UUID,
    "points" INTEGER NOT NULL DEFAULT 0,
    "checkIns" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastCheckInDay" DATE,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeCheckIn" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "postId" UUID,
    "text" TEXT,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ChallengeCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Badge_key_key" ON "Badge"("key");

-- CreateIndex
CREATE INDEX "UserBadge_badgeId_idx" ON "UserBadge"("badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_slug_key" ON "Challenge"("slug");

-- CreateIndex
CREATE INDEX "Challenge_status_startsAt_idx" ON "Challenge"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeParticipant_paymentId_key" ON "ChallengeParticipant"("paymentId");

-- CreateIndex
CREATE INDEX "ChallengeParticipant_challengeId_points_idx" ON "ChallengeParticipant"("challengeId", "points");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeParticipant_challengeId_userId_key" ON "ChallengeParticipant"("challengeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeCheckIn_participantId_day_key" ON "ChallengeCheckIn"("participantId", "day");

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeCheckIn" ADD CONSTRAINT "ChallengeCheckIn_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
