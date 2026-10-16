-- LUM-1215: what the path filters left out of the AI review (additive, nullable).
ALTER TABLE "pr_security_scans" ADD COLUMN "reviewPathSkips" JSONB;
