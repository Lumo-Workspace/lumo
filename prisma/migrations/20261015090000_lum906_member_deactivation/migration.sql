-- LUM-906 PR2: soft deactivation of workspace members (additive, no backfill).
-- Removing, leaving and identity-provider deprovisioning set these instead of
-- deleting the row (11 RESTRICT foreign keys reference workspace_members, and
-- a delete cascaded the member's sessions and hook events).
ALTER TABLE "workspace_members" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "workspace_members" ADD COLUMN "deactivationReason" TEXT;
