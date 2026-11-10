-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'REVIEW', 'SCHEDULED', 'LIVE', 'VOTING', 'EVALUATION', 'WINNER_DECLARATION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('PENDING_PAYMENT', 'REGISTERED', 'SUBMITTED', 'QUALIFIED', 'FINALIST', 'WINNER', 'DISQUALIFIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ContestTaskType" AS ENUM ('POST', 'TEXT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'CAPTURED', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

-- CreateTable
CREATE TABLE "ContestCategory" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ContestCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "categoryId" UUID,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "feePaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "minParticipants" INTEGER NOT NULL DEFAULT 0,
    "maxParticipants" INTEGER,
    "registrationOpensAt" TIMESTAMP(3) NOT NULL,
    "registrationClosesAt" TIMESTAMP(3) NOT NULL,
    "submissionClosesAt" TIMESTAMP(3) NOT NULL,
    "votingClosesAt" TIMESTAMP(3) NOT NULL,
    "publicWeight" INTEGER NOT NULL DEFAULT 40,
    "votesPerUserPerDay" INTEGER NOT NULL DEFAULT 1,
    "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "eligibleSpeciesIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rules" TEXT,
    "terms" TEXT,
    "finance" JSONB NOT NULL DEFAULT '{}',
    "legalReviewApprovedAt" TIMESTAMP(3),
    "legalReviewApprovedBy" UUID,
    "legalReviewNote" TEXT,
    "leaderboardFrozenAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestTask" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "ContestTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,

CONSTRAINT "ContestTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeCriterion" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,

CONSTRAINT "JudgeCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestJudge" (
    "contestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ContestJudge_pkey" PRIMARY KEY ("contestId","userId")
);

-- CreateTable
CREATE TABLE "ContestPrize" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "rank" INTEGER,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountPaise" INTEGER,
    "description" TEXT,
    "participantId" UUID,
    "payoutStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ContestPrize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestParticipant" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "petId" UUID NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "statusReason" TEXT,
    "paymentId" UUID,
    "registeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ContestParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestSubmission" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "postId" UUID,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ContestSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestVote" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "voterId" UUID NOT NULL,
    "voteDate" DATE NOT NULL,
    "ipHash" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ContestVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestJudgeScore" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "judgeId" UUID NOT NULL,
    "criterionId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ContestJudgeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "id" UUID NOT NULL,
    "contestId" UUID NOT NULL,
    "rows" JSONB NOT NULL,
    "frozenById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "referenceId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContestCategory_key_key" ON "ContestCategory"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");

-- CreateIndex
CREATE INDEX "Contest_status_registrationClosesAt_idx" ON "Contest"("status", "registrationClosesAt");

-- CreateIndex
CREATE INDEX "Contest_categoryId_idx" ON "Contest"("categoryId");

-- CreateIndex
CREATE INDEX "ContestTask_contestId_position_idx" ON "ContestTask"("contestId", "position");

-- CreateIndex
CREATE INDEX "JudgeCriterion_contestId_idx" ON "JudgeCriterion"("contestId");

-- CreateIndex
CREATE INDEX "ContestJudge_userId_idx" ON "ContestJudge"("userId");

-- CreateIndex
CREATE INDEX "ContestPrize_contestId_rank_idx" ON "ContestPrize"("contestId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipant_paymentId_key" ON "ContestParticipant"("paymentId");

-- CreateIndex
CREATE INDEX "ContestParticipant_contestId_status_idx" ON "ContestParticipant"("contestId", "status");

-- CreateIndex
CREATE INDEX "ContestParticipant_userId_idx" ON "ContestParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipant_contestId_petId_key" ON "ContestParticipant"("contestId", "petId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestSubmission_participantId_taskId_key" ON "ContestSubmission"("participantId", "taskId");

-- CreateIndex
CREATE INDEX "ContestVote_contestId_voterId_voteDate_idx" ON "ContestVote"("contestId", "voterId", "voteDate");

-- CreateIndex
CREATE INDEX "ContestVote_participantId_flagged_idx" ON "ContestVote"("participantId", "flagged");

-- CreateIndex
CREATE INDEX "ContestVote_contestId_ipHash_voteDate_idx" ON "ContestVote"("contestId", "ipHash", "voteDate");

-- CreateIndex
CREATE UNIQUE INDEX "ContestVote_contestId_voterId_participantId_voteDate_key" ON "ContestVote"("contestId", "voterId", "participantId", "voteDate");

-- CreateIndex
CREATE UNIQUE INDEX "ContestJudgeScore_participantId_judgeId_criterionId_key" ON "ContestJudgeScore"("participantId", "judgeId", "criterionId");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_contestId_createdAt_idx" ON "LeaderboardSnapshot"("contestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_purpose_referenceId_idx" ON "Payment"("purpose", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ContestCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestTask" ADD CONSTRAINT "ContestTask_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeCriterion" ADD CONSTRAINT "JudgeCriterion_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestJudge" ADD CONSTRAINT "ContestJudge_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestJudge" ADD CONSTRAINT "ContestJudge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestPrize" ADD CONSTRAINT "ContestPrize_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestPrize" ADD CONSTRAINT "ContestPrize_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ContestParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ContestParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestSubmission" ADD CONSTRAINT "ContestSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ContestTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestVote" ADD CONSTRAINT "ContestVote_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestVote" ADD CONSTRAINT "ContestVote_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ContestParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestVote" ADD CONSTRAINT "ContestVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestJudgeScore" ADD CONSTRAINT "ContestJudgeScore_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ContestParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestJudgeScore" ADD CONSTRAINT "ContestJudgeScore_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestJudgeScore" ADD CONSTRAINT "ContestJudgeScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "JudgeCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshot" ADD CONSTRAINT "LeaderboardSnapshot_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
