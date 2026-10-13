-- LUM-1097: the workspace's default language (Slack channel posts, and DMs to
-- members with no language preference). Additive only: one NOT NULL column
-- with a constant default, so existing rows read 'en' and nothing is rewritten.

ALTER TABLE "workspaces" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'en';
