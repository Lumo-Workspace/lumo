-- LUM-1117 phase 2: 删除 summaryLocale 列(数据已迁入 defaultLocale).
-- Drops the workspace's old AI-summary language column. Its values were
-- copied into defaultLocale by 20261101090000_lum1117_backfill_default_locale,
-- and the code deployed with that migration no longer reads or writes it.
-- Merge and deploy only after phase 1 is live in production.

ALTER TABLE "workspaces" DROP COLUMN "summaryLocale";
