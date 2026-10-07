-- LUM-1041: app-level idempotency for outgoing email (additive only).
-- One row per idempotency key: claimed SENDING before the SMTP send, settled
-- SENT / FAILED after. Not workspace-scoped (system emails, no workspaceId).

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "attemptStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_idempotencyKey_key" ON "email_deliveries"("idempotencyKey");
