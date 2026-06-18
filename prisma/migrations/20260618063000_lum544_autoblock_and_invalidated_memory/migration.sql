-- LUM-544: automate session-wrap sections.
-- (1) New MemoryStatus value INVALIDATED for DONE-time Layer-1 curation
--     (clearly-wrong memories retired without a replacement row).
-- (2) auto_blocks ledger backing the server-side blocked-tag automation
--     (idempotency / auto-untag-on-progress / attribution).

-- AlterEnum
ALTER TYPE "MemoryStatus" ADD VALUE 'INVALIDATED';

-- CreateTable
CREATE TABLE "auto_blocks" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "triggeringSessionId" TEXT,
    "model" TEXT,
    "topFailureLabel" TEXT,
    "failureCount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "auto_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auto_blocks_taskId_idx" ON "auto_blocks"("taskId");

-- Idempotency: at most one ACTIVE auto-block per task. Partial unique index —
-- inexpressible in Prisma schema, so hand-written here. A second threshold
-- crossing's insert conflicts and is swallowed (ON CONFLICT DO NOTHING in the
-- repository), making auto-blocking effectively at-most-once.
CREATE UNIQUE INDEX "auto_blocks_active_task_uq"
    ON "auto_blocks"("taskId") WHERE "active";

-- AddForeignKey
ALTER TABLE "auto_blocks" ADD CONSTRAINT "auto_blocks_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
