-- Change the default value of Document.title from the English literal
-- "Untitled" to an empty string, so the UI can render a localised
-- placeholder via i18n (en: "Untitled", zh-CN: "无标题", …) instead of
-- the database silently filling in the English string when no title is
-- provided.

ALTER TABLE "Document" ALTER COLUMN "title" SET DEFAULT '';
