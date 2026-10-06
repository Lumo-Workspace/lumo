-- LUM-919: subprocessor change notices sent to workspace owners (additive).
CREATE TABLE "subprocessor_notice_deliveries" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subprocessor_notice_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subprocessor_notice_deliveries_changeId_workspaceId_clerkId_key" ON "subprocessor_notice_deliveries"("changeId", "workspaceId", "clerkId");

CREATE INDEX "subprocessor_notice_deliveries_workspaceId_idx" ON "subprocessor_notice_deliveries"("workspaceId");

ALTER TABLE "subprocessor_notice_deliveries" ADD CONSTRAINT "subprocessor_notice_deliveries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
