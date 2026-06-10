-- LUM-343: TaskActivity mirror events for the acceptance verification loop.
-- Additive enum extension only — no table or data changes.
ALTER TYPE "TaskActivityType" ADD VALUE 'CRITERION_CHANGED';
ALTER TYPE "TaskActivityType" ADD VALUE 'VERIFICATION_RUN_RECORDED';
ALTER TYPE "TaskActivityType" ADD VALUE 'VERIFICATION_ESCALATED';
