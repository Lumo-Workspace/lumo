/**
 * LUM-1117 — AI summaries are written in the workspace's one language field,
 * `Workspace.defaultLocale`, which absorbed the old summary-only language
 * column.
 *
 * The summary prompt and the report parser (`## Today's Focus` /
 * `## 今日关注`) only exist in English and Chinese, so every other language
 * falls back to English.
 */
export type SummaryLanguage = 'en' | 'zh'

/** The language a summary is generated in for a workspace locale. */
export function summaryLanguageFor(
  locale: string | null | undefined
): SummaryLanguage {
  return (locale ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
