-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'PRODUCT';
ALTER TYPE "ReportTarget" ADD VALUE 'SERVICE_REVIEW';
ALTER TYPE "ReportTarget" ADD VALUE 'CONTEST_ENTRY';

-- CreateEnum
CREATE TYPE "AiVerdict" AS ENUM ('CLEAR', 'FLAGGED', 'ERROR');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "perceptualHash" TEXT;

-- AlterTable
ALTER TABLE "ModerationCase" ADD COLUMN     "aiAssessmentId" UUID,
ADD COLUMN     "aiFlaggedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiAssessment" (
    "id" UUID NOT NULL,
    "targetType" "ReportTarget" NOT NULL,
    "targetId" UUID NOT NULL,
    "ownerId" UUID,
    "inputHash" TEXT NOT NULL,
    "verdict" "AiVerdict" NOT NULL,
    "labels" JSONB NOT NULL DEFAULT '[]',
    "topLabel" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRisk" (
    "userId" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "level" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "reviewedScore" INTEGER,

    CONSTRAINT "AccountRisk_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "MediaAsset_perceptualHash_idx" ON "MediaAsset"("perceptualHash");

-- CreateIndex
CREATE INDEX "ModerationCase_status_aiFlaggedAt_idx" ON "ModerationCase"("status", "aiFlaggedAt");

-- CreateIndex
CREATE INDEX "AiAssessment_targetType_targetId_createdAt_idx" ON "AiAssessment"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAssessment_verdict_createdAt_idx" ON "AiAssessment"("verdict", "createdAt");

-- CreateIndex
CREATE INDEX "AiAssessment_ownerId_verdict_createdAt_idx" ON "AiAssessment"("ownerId", "verdict", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiAssessment_targetType_targetId_inputHash_key" ON "AiAssessment"("targetType", "targetId", "inputHash");

-- CreateIndex
CREATE INDEX "AccountRisk_level_score_idx" ON "AccountRisk"("level", "score");

-- AddForeignKey
ALTER TABLE "ModerationCase" ADD CONSTRAINT "ModerationCase_aiAssessmentId_fkey" FOREIGN KEY ("aiAssessmentId") REFERENCES "AiAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRisk" ADD CONSTRAINT "AccountRisk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Scores stay in range (the service computes them; the database refuses nonsense).
ALTER TABLE "AccountRisk" ADD CONSTRAINT "AccountRisk_score_range" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "AiAssessment" ADD CONSTRAINT "AiAssessment_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1);
