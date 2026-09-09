-- LUM-737: one-shot agent reminder marker on PR security scans. Additive —
-- one nullable column, no existing table or column touched, nothing removed.
ALTER TABLE "pr_security_scans" ADD COLUMN "agentNotifiedAt" TIMESTAMP(3);
