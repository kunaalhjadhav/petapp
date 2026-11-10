-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'PAYOUT_ACCOUNT';

-- CreateEnum
CREATE TYPE "PayoutAccountStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('CUSTOMER', 'COMMISSION', 'CREDIT_NOTE');

-- AlterTable
ALTER TABLE "ContestPrize" ADD COLUMN     "payoutId" UUID;

-- CreateTable
CREATE TABLE "PayoutAccount" (
    "id" UUID NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "ifsc" TEXT,
    "accountLast4" TEXT,
    "accountNumberEnc" TEXT,
    "vpa" TEXT,
    "status" "PayoutAccountStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedName" TEXT,
    "failureReason" TEXT,
    "providerContactId" TEXT,
    "providerFundAccountId" TEXT,
    "providerValidationId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "payableFrom" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "payeeType" TEXT NOT NULL,
    "payeeId" UUID NOT NULL,
    "payeeName" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "providerPayoutId" TEXT,
    "utr" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewaySettlement" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSettlementId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "feesPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL,
    "utr" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewaySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("series")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceKey" TEXT NOT NULL,
    "issuer" JSONB NOT NULL,
    "recipient" JSONB NOT NULL,
    "placeOfSupply" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "taxablePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL,
    "sgstPaise" INTEGER NOT NULL,
    "igstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "customerId" UUID,
    "payeeKey" TEXT,
    "originalInvoiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutAccount_ownerType_ownerId_status_idx" ON "PayoutAccount"("ownerType", "ownerId", "status");

-- CreateIndex
CREATE INDEX "PayoutAccount_status_updatedAt_idx" ON "PayoutAccount"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_code_key" ON "PayoutBatch"("code");

-- CreateIndex
CREATE INDEX "PayoutBatch_status_createdAt_idx" ON "PayoutBatch"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_providerPayoutId_key" ON "Payout"("providerPayoutId");

-- CreateIndex
CREATE INDEX "Payout_batchId_idx" ON "Payout"("batchId");

-- CreateIndex
CREATE INDEX "Payout_payeeType_payeeId_createdAt_idx" ON "Payout"("payeeType", "payeeId", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_status_nextAttemptAt_idx" ON "Payout"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "GatewaySettlement_settledAt_idx" ON "GatewaySettlement"("settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "GatewaySettlement_provider_providerSettlementId_key" ON "GatewaySettlement"("provider", "providerSettlementId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_payeeKey_issuedAt_idx" ON "Invoice"("payeeKey", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_kind_sourceKey_key" ON "Invoice"("kind", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_series_seq_key" ON "Invoice"("series", "seq");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PayoutAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Guards (not expressible in the Prisma schema) ───────────────

-- At most one verified payout account per payee (a new one replaces the old only once it is verified).
CREATE UNIQUE INDEX "PayoutAccount_one_verified_per_owner" ON "PayoutAccount"("ownerType", "ownerId") WHERE "status" = 'VERIFIED';

-- At most one payout on its way to a payee at a time (prepared, queued or being sent).
CREATE UNIQUE INDEX "Payout_one_open_per_payee" ON "Payout"("payeeType", "payeeId") WHERE "status" IN ('DRAFT', 'QUEUED', 'PROCESSING');

-- Payouts are positive; issued invoices never change.
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_positive" CHECK ("amountPaise" > 0);

CREATE OR REPLACE FUNCTION invoice_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Invoices are immutable once issued: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_immutable
BEFORE UPDATE OR DELETE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION invoice_immutable();
