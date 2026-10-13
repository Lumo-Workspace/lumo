/**
 * LUM-1117 — AI summaries are written in the workspace's one language field,
 * `Workspace.defaultLocale`, which absorbed the old summary-only language
 * column.
 *
 * The summary prompt and the report parser exist in English, Simplified
 * Chinese (`zh`) and Traditional Chinese (`zh-Hant`, LUM-1121); every other
 * language falls back to English.
 */
export type SummaryLanguage = 'en' | 'zh' | 'zh-Hant'

/** Script or region subtags that mean Traditional Chinese. */
const TRADITIONAL_SUBTAGS = ['hant', 'tw', 'hk', 'mo']

/** The language a summary is generated in for a workspace locale. */
export function summaryLanguageFor(
  locale: string | null | undefined
): SummaryLanguage {
  const [lang, ...subtags] = (locale ?? '').toLowerCase().split(/[-_]/)
  if (lang !== 'zh') return 'en'
  if (subtags.includes('hans')) return 'zh'
  return subtags.some(s => TRADITIONAL_SUBTAGS.includes(s)) ? 'zh-Hant' : 'zh'
}
