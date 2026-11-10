-- Phase 10a: staff two-factor sign-in (authenticator app codes and recovery codes).

ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT, ADD COLUMN "mfaEnabledAt" TIMESTAMP(3), ADD COLUMN "mfaLastStep" INTEGER;

CREATE TABLE "MfaRecoveryCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MfaRecoveryCode_userId_codeHash_key" ON "MfaRecoveryCode"("userId", "codeHash");
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
