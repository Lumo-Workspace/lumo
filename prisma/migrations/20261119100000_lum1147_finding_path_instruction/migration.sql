-- LUM-1147 follow-up: the path instruction (its glob) an AI review finding
-- applies. Additive: one nullable column, no backfill (null = not from a
-- path instruction, today's behaviour).
ALTER TABLE "pr_security_findings" ADD COLUMN "pathInstruction" TEXT;
