-- Additive enum value for the rework-not-followup spinoff audit (LUM-511 Phase 3).
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'TASK_SPUN_OFF';
