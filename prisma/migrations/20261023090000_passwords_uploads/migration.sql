-- Phase 9e: staff password change and reset by email; resumable (multipart) uploads.

ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

ALTER TABLE "MediaAsset" ADD COLUMN "multipartUploadId" TEXT, ADD COLUMN "partSize" INTEGER;

CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedBy" TEXT NOT NULL DEFAULT 'SELF',
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX "PasswordReset_userId_createdAt_idx" ON "PasswordReset"("userId", "createdAt");
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
