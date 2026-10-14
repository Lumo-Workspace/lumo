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

/** Regions that write Traditional Chinese when the tag names no script. */
const TRADITIONAL_REGIONS = ['tw', 'hk', 'mo']

/**
 * The language a summary is generated in for a workspace locale.
 *
 * Reads the tag positionally (BCP 47: language, optional 4-letter script,
 * optional region; variants, extensions and private use are ignored). An
 * explicit script decides; without one, a Traditional-writing region does.
 */
export function summaryLanguageFor(
  locale: string | null | undefined
): SummaryLanguage {
  const [lang, ...rest] = (locale ?? '').toLowerCase().split(/[-_]/)
  if (lang !== 'zh') return 'en'
  const script = rest[0]?.length === 4 ? rest[0] : null
  if (script) return script === 'hant' ? 'zh-Hant' : 'zh'
  const region = rest[0]
  return region && TRADITIONAL_REGIONS.includes(region) ? 'zh-Hant' : 'zh'
}
