-- LUM-646 (F4/自治边界): agent-claimable triage marker on Task.
-- Purely additive, fail-closed default (a task is not auto-claimable until a
-- steward/human triages it). Advisory only — nothing is gated on it.
ALTER TABLE "tasks" ADD COLUMN "claimable" BOOLEAN NOT NULL DEFAULT false;
