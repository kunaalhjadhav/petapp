-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_PROCESSED';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "RefundStatus" ADD VALUE 'FAILED';
ALTER TYPE "RefundStatus" ADD VALUE 'SETTLED_MANUALLY';

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('RUNNING', 'OK', 'ISSUES', 'FAILED');

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "manualReference" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "providerRefundId" TEXT,
ADD COLUMN     "retries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settledById" UUID,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ServicePartner" ADD COLUMN     "pan" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "pan" TEXT;

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "ownerType" TEXT,
    "ownerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debitPaise" INTEGER NOT NULL DEFAULT 0,
    "creditPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" UUID NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "startedById" UUID,
    "summary" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "repaired" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE INDEX "LedgerAccount_ownerType_ownerId_idx" ON "LedgerAccount"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reference_key" ON "LedgerTransaction"("reference");

-- CreateIndex
CREATE INDEX "LedgerTransaction_sourceType_sourceId_idx" ON "LedgerTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_kind_occurredAt_idx" ON "LedgerTransaction"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_occurredAt_idx" ON "LedgerTransaction"("occurredAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_startedAt_idx" ON "ReconciliationRun"("startedAt");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_runId_idx" ON "ReconciliationIssue"("runId");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_resolvedAt_severity_idx" ON "ReconciliationIssue"("resolvedAt", "severity");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_reference_idx" ON "ReconciliationIssue"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");

-- CreateIndex
CREATE INDEX "Refund_status_nextAttemptAt_idx" ON "Refund"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────── Ledger guards (not expressible in the Prisma schema) ───────────────

-- Each entry is either a debit or a credit, never both, never negative, never zero.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_one_side_check"
  CHECK ("debitPaise" >= 0 AND "creditPaise" >= 0 AND (("debitPaise" = 0) <> ("creditPaise" = 0)));

-- The ledger is append-only: corrections are new, reversing transactions.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_append_only
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER ledger_transaction_append_only
BEFORE UPDATE OR DELETE ON "LedgerTransaction"
FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- Every journal entry balances and has at least two lines. Checked at COMMIT (deferred),
-- so a transaction and its entries can be written in any order within one database transaction.
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  txid UUID;
  dr BIGINT;
  cr BIGINT;
  n INT;
BEGIN
  -- Separate branches: a record field is only looked up when its branch runs.
  IF TG_TABLE_NAME = 'LedgerEntry' THEN
    txid := NEW."transactionId";
  ELSE
    txid := NEW."id";
  END IF;
  SELECT COALESCE(SUM("debitPaise"), 0), COALESCE(SUM("creditPaise"), 0), COUNT(*)
    INTO dr, cr, n FROM "LedgerEntry" WHERE "transactionId" = txid;
  IF n < 2 THEN
    RAISE EXCEPTION 'Ledger transaction % has % entries; at least 2 are required', txid, n;
  END IF;
  IF dr <> cr THEN
    RAISE EXCEPTION 'Ledger transaction % is unbalanced: debits % <> credits %', txid, dr, cr;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_transaction_balanced
AFTER INSERT ON "LedgerTransaction"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

CREATE CONSTRAINT TRIGGER ledger_entry_balanced
AFTER INSERT ON "LedgerEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
