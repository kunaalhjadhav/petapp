-- Phase 8b: privacy and legal

CREATE TYPE "LegalStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

CREATE TABLE "LegalDocument" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "changeSummary" TEXT,
    "status" "LegalStatus" NOT NULL DEFAULT 'DRAFT',
    "requiresAcceptance" BOOLEAN NOT NULL DEFAULT false,
    "effectiveAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID,
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LegalDocument_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "LegalDocument_slug_version_key" ON "LegalDocument"("slug", "version");
CREATE INDEX "LegalDocument_slug_status_idx" ON "LegalDocument"("slug", "status");
-- At most one current version of each document.
CREATE UNIQUE INDEX "LegalDocument_one_published" ON "LegalDocument"("slug") WHERE "status" = 'PUBLISHED';

CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "version" INTEGER,
    "granted" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConsentRecord_kind_check" CHECK ("kind" IN ('DOCUMENT', 'MARKETING'))
);
CREATE INDEX "ConsentRecord_userId_subject_createdAt_idx" ON "ConsentRecord"("userId", "subject", "createdAt");
CREATE INDEX "ConsentRecord_subject_version_idx" ON "ConsentRecord"("subject", "version");
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Consent history is evidence: it is never edited.
CREATE OR REPLACE FUNCTION consent_record_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ConsentRecord rows cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consent_record_no_update BEFORE UPDATE ON "ConsentRecord" FOR EACH ROW EXECUTE FUNCTION consent_record_append_only();

CREATE TABLE "DataExport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DataExport_userId_createdAt_idx" ON "DataExport"("userId", "createdAt");
CREATE INDEX "DataExport_status_expiresAt_idx" ON "DataExport"("status", "expiresAt");
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A copy of someone's data is ready to download.
ALTER TYPE "NotificationType" ADD VALUE 'DATA_EXPORT_READY';
