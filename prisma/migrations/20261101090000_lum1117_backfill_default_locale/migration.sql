-- LUM-1117 phase 1: merge the workspace's AI-summary language into its one
-- language field. A workspace still on the default 'en' takes the language its
-- summaryLocale names ('zh', the only other value the settings page offered,
-- becomes 'zh-CN'). When both are set and disagree, defaultLocale wins — it is
-- the newer, explicit choice. Values naming no supported language are left
-- alone. Rows only: the summaryLocale column is dropped in phase 2, once the
-- code that stops reading it is deployed.

UPDATE "workspaces"
SET "defaultLocale" = CASE
    WHEN lower("summaryLocale") IN ('zh', 'zh-cn', 'zh-hans', 'zh-sg') THEN 'zh-CN'
    WHEN lower("summaryLocale") IN ('zh-tw', 'zh-hant', 'zh-hk', 'zh-mo') THEN 'zh-TW'
    ELSE "summaryLocale"
  END
WHERE "defaultLocale" = 'en'
  AND "summaryLocale" <> 'en'
  AND (
    lower("summaryLocale") IN (
      'zh', 'zh-cn', 'zh-hans', 'zh-sg',
      'zh-tw', 'zh-hant', 'zh-hk', 'zh-mo'
    )
    OR "summaryLocale" IN (
      'en-GB', 'en-AU', 'es-ES', 'es-419', 'fr', 'de',
      'ja', 'ko', 'hi', 'ru', 'vi', 'id', 'ms'
    )
  );
