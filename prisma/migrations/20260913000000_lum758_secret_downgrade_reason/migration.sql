-- LUM-758 (follow-up): additive only — one new enum type and one nullable
-- column. No existing table, column or row is touched, so this is safe to
-- apply ahead of the code that writes it.
--
-- Why: scan-secrets.ts already computes WHY a secret hit was lowered to LOW
-- (a placeholder value, or a test/fixture/doc path) and hands it to the
-- session-side boundary detector as `SecretDowngradeReason`. It was dropped at
-- the persistence boundary, so the PR-findings path had no access to it and
-- `lumo task status` rendered lines reading "AWS access key ID" with nothing
-- saying the scanner had already recognised them as placeholders. The type's
-- own doc comment says consumers need the cause **as data, not parsed back out
-- of `detail`** — this column is what makes that true on the persisted path.
CREATE TYPE "PrSecuritySecretDowngrade" AS ENUM ('PLACEHOLDER_VALUE', 'DOWNGRADED_PATH');

ALTER TABLE "pr_security_findings" ADD COLUMN "secretDowngrade" "PrSecuritySecretDowngrade";
