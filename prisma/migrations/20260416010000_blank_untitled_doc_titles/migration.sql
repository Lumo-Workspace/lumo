-- Backfill: clear the literal "Untitled" title on documents that have no
-- content, so the UI can render a localised placeholder via i18n
-- (en: "Untitled", zh-CN: "无标题", …) instead of the hard-coded English string
-- that older versions of the create flow stored in the database.
--
-- Scope is intentionally narrow: only documents that were never edited
-- (content IS NULL). Documents whose author actually named them "Untitled"
-- and then wrote content are left untouched.

UPDATE "Document"
SET "title" = ''
WHERE "title" = 'Untitled'
  AND "content" IS NULL;
