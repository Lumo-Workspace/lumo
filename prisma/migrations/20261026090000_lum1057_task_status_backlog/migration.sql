-- LUM-1057: additive BACKLOG status for not-yet-scheduled tasks.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'BACKLOG' BEFORE 'TODO';
