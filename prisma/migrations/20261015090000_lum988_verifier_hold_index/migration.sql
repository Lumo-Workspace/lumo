-- LUM-988: index for the stale verifier-hold sweep (every 15 minutes:
-- verifiedAt IS NULL AND verifierStartedAt < cutoff). Additive only.

-- CreateIndex
CREATE INDEX "pr_security_scans_verifiedAt_verifierStartedAt_idx" ON "pr_security_scans"("verifiedAt", "verifierStartedAt");
