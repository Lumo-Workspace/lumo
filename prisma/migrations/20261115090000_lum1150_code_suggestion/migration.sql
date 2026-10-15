-- LUM-1150: committable suggestions in inline review comments. Additive only:
-- one nullable column on pr_security_findings. No existing row changes.

-- AlterTable
ALTER TABLE "pr_security_findings" ADD COLUMN "codeSuggestion" JSONB;
