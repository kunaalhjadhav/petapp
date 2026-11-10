-- Phase 7c: PetApp Assistant

CREATE TYPE "AssistantRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "AssistantSafety" AS ENUM ('NONE', 'GENERAL_INFO', 'URGENT');

CREATE TABLE "AssistantConversation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssistantConversation_userId_lastMessageAt_idx" ON "AssistantConversation"("userId", "lastMessageAt");
CREATE INDEX "AssistantConversation_lastMessageAt_idx" ON "AssistantConversation"("lastMessageAt");
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AssistantMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "text" TEXT NOT NULL,
    "cards" JSONB NOT NULL DEFAULT '[]',
    "safety" "AssistantSafety" NOT NULL DEFAULT 'NONE',
    "tools" JSONB NOT NULL DEFAULT '[]',
    "provider" TEXT,
    "model" TEXT,
    "version" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "rating" TEXT,
    "ratingNote" TEXT,
    "ratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssistantMessage_rating_check" CHECK ("rating" IS NULL OR "rating" IN ('UP', 'DOWN'))
);
CREATE INDEX "AssistantMessage_conversationId_createdAt_idx" ON "AssistantMessage"("conversationId", "createdAt");
CREATE INDEX "AssistantMessage_role_createdAt_idx" ON "AssistantMessage"("role", "createdAt");
CREATE INDEX "AssistantMessage_rating_ratedAt_idx" ON "AssistantMessage"("rating", "ratedAt");
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
