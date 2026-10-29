-- LUM-1303: Activity entries for task decisions (recorded / edited / deleted).
-- Additive: three new enum values, no rows touched. Kept apart from the table
-- migration so no transaction both adds and uses a value.

ALTER TYPE "TaskActivityType" ADD VALUE 'DECISION_ADDED';
ALTER TYPE "TaskActivityType" ADD VALUE 'DECISION_UPDATED';
ALTER TYPE "TaskActivityType" ADD VALUE 'DECISION_REMOVED';
