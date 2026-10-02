-- LUM-911: scan evidence retention. Additive only.

-- Workspace setting: days a used-up scan keeps its code (0 / 7 / 14 / 30).
ALTER TABLE "workspaces" ADD COLUMN "scanEvidenceRetentionDays" INTEGER NOT NULL DEFAULT 7;

-- When a scan's code fields were scrubbed; null = not scrubbed.
ALTER TABLE "pr_security_scans" ADD COLUMN "codeScrubbedAt" TIMESTAMP(3);

-- Existing scans are added as false so the retention sweep leaves them alone
-- (the backlog is its own task); the default then flips to true for new rows.
ALTER TABLE "pr_security_scans" ADD COLUMN "retentionTracked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pr_security_scans" ALTER COLUMN "retentionTracked" SET DEFAULT true;
