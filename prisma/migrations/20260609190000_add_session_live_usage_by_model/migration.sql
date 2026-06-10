-- AlterTable: mid-turn per-model usage snapshot (LUM-345 follow-up).
-- Additive only; null on all existing rows.
ALTER TABLE "sessions" ADD COLUMN "liveUsageByModel" JSONB;
