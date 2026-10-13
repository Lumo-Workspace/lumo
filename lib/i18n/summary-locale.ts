import { PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/public-locale'

/**
 * LUM-1117 — AI summaries are written in the workspace's one language field,
 * `Workspace.defaultLocale` (the old `summaryLocale` column is retired).
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

const SIMPLIFIED_CHINESE = ['zh', 'zh-cn', 'zh-hans', 'zh-sg']
const TRADITIONAL_CHINESE = ['zh-tw', 'zh-hant', 'zh-hk', 'zh-mo']

/**
 * A value of the retired `summaryLocale` field as a `defaultLocale` code:
 * 'zh' (the only non-English value the settings page offered) is 'zh-CN';
 * null for a value that names no supported language.
 */
export function defaultLocaleFromSummaryLocale(
  value: string | null | undefined
): PublicLocale | null {
  const lower = (value ?? '').trim().toLowerCase()
  if (!lower) return null
  if (SIMPLIFIED_CHINESE.includes(lower)) return 'zh-CN'
  if (TRADITIONAL_CHINESE.includes(lower)) return 'zh-TW'
  return PUBLIC_LOCALES.find(l => l.toLowerCase() === lower) ?? null
}
