-- LUM-1284: NONE ("not assessed") task priority. ADD VALUE alone in its own
-- migration (PG forbids using a freshly added enum value in the same
-- transaction). BEFORE 'LOW' keeps the enum order NONE < LOW < MEDIUM < HIGH <
-- URGENT, so ORDER BY priority DESC puts unassessed tasks last.
ALTER TYPE "TaskPriority" ADD VALUE IF NOT EXISTS 'NONE' BEFORE 'LOW';
