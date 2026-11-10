-- Phase 9a: chat (customer ↔ service partner, customer ↔ seller, person ↔ staff) and the support center

ALTER TYPE "ReportTarget" ADD VALUE 'CHAT_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'CHAT_MESSAGE';

ALTER TABLE "NotificationPreference" ADD COLUMN "chat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MediaAsset" ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "ConversationKind" AS ENUM ('SERVICE', 'SHOP', 'SUPPORT');
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ChatSide" AS ENUM ('CUSTOMER', 'BUSINESS', 'STAFF', 'SYSTEM');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "customerId" UUID NOT NULL,
    "partnerId" UUID,
    "vendorId" UUID,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageText" TEXT,
    "customerUnread" INTEGER NOT NULL DEFAULT 0,
    "otherUnread" INTEGER NOT NULL DEFAULT 0,
    "customerReadAt" TIMESTAMP(3),
    "otherReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id"),
    -- Exactly the right other party for each kind.
    CONSTRAINT "Conversation_party_check" CHECK (
        ("kind" = 'SERVICE' AND "partnerId" IS NOT NULL AND "vendorId" IS NULL) OR
        ("kind" = 'SHOP' AND "vendorId" IS NOT NULL AND "partnerId" IS NULL) OR
        ("kind" = 'SUPPORT' AND "partnerId" IS NULL AND "vendorId" IS NULL)
    ),
    CONSTRAINT "Conversation_unread_check" CHECK ("customerUnread" >= 0 AND "otherUnread" >= 0)
);
CREATE UNIQUE INDEX "Conversation_kind_customerId_partnerId_key" ON "Conversation"("kind", "customerId", "partnerId");
CREATE UNIQUE INDEX "Conversation_kind_customerId_vendorId_key" ON "Conversation"("kind", "customerId", "vendorId");
CREATE INDEX "Conversation_customerId_lastMessageAt_idx" ON "Conversation"("customerId", "lastMessageAt");
CREATE INDEX "Conversation_partnerId_lastMessageAt_idx" ON "Conversation"("partnerId", "lastMessageAt");
CREATE INDEX "Conversation_vendorId_lastMessageAt_idx" ON "Conversation"("vendorId", "lastMessageAt");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ServicePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID,
    "side" "ChatSide" NOT NULL,
    "body" TEXT,
    "mediaId" UUID,
    "refType" TEXT,
    "refId" UUID,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChatMessage_status_check" CHECK ("status" IN ('VISIBLE', 'HIDDEN', 'REMOVED')),
    CONSTRAINT "ChatMessage_ref_check" CHECK (("refType" IS NULL AND "refId" IS NULL) OR ("refType" IN ('BOOKING', 'PRODUCT', 'ORDER') AND "refId" IS NOT NULL)),
    -- Only staff write notes.
    CONSTRAINT "ChatMessage_internal_check" CHECK (NOT "internal" OR "side" = 'STAFF'),
    CONSTRAINT "ChatMessage_body_length" CHECK ("body" IS NULL OR char_length("body") <= 4000)
);
CREATE UNIQUE INDEX "ChatMessage_senderId_clientId_key" ON "ChatMessage"("senderId", "clientId");
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupportCategory" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportCategory_audience_check" CHECK ("audience" IN ('ALL', 'CUSTOMER', 'PARTNER', 'SELLER'))
);
CREATE UNIQUE INDEX "SupportCategory_key_key" ON "SupportCategory"("key");

CREATE TABLE "SupportFaq" (
    "id" UUID NOT NULL,
    "categoryId" UUID,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "helpful" INTEGER NOT NULL DEFAULT 0,
    "notHelpful" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportFaq_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportFaq_audience_check" CHECK ("audience" IN ('ALL', 'CUSTOMER', 'PARTNER', 'SELLER'))
);
CREATE INDEX "SupportFaq_published_audience_sortOrder_idx" ON "SupportFaq"("published", "audience", "sortOrder");
ALTER TABLE "SupportFaq" ADD CONSTRAINT "SupportFaq_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupportTicket" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "assigneeId" UUID,
    "conversationId" UUID NOT NULL,
    "app" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "refType" TEXT,
    "refId" UUID,
    "createdById" UUID,
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportTicket_app_check" CHECK ("app" IN ('CUSTOMER', 'PARTNER', 'SELLER', 'STAFF')),
    CONSTRAINT "SupportTicket_ref_check" CHECK (("refType" IS NULL AND "refId" IS NULL) OR ("refType" IN ('BOOKING', 'ORDER') AND "refId" IS NOT NULL))
);
CREATE UNIQUE INDEX "SupportTicket_code_key" ON "SupportTicket"("code");
CREATE UNIQUE INDEX "SupportTicket_conversationId_key" ON "SupportTicket"("conversationId");
CREATE INDEX "SupportTicket_status_priority_updatedAt_idx" ON "SupportTicket"("status", "priority", "updatedAt");
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");
CREATE INDEX "SupportTicket_assigneeId_status_idx" ON "SupportTicket"("assigneeId", "status");
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SupportCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
