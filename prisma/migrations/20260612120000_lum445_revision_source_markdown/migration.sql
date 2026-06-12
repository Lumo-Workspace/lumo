-- LUM-445: revision restore must not lock the markdown write path.
--
-- Additive only. A new nullable column captures the byte-identical markdown
-- source alongside each revision's HTML snapshot. A restore re-establishes
-- Document.sourceMarkdown from this column instead of nulling it, so restoring a
-- markdown-authored revision keeps the markdown write path (raw/append/section/
-- diff) alive. Existing revisions stay NULL (HTML-only history) — no backfill, no
-- row deleted, no behaviour change until snapshots start capturing the source.
-- Production applies via `prisma migrate deploy` on next deploy.

ALTER TABLE "DocumentRevision" ADD COLUMN IF NOT EXISTS "sourceMarkdown" TEXT;
