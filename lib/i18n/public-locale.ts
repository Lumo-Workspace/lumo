/**
 * Locale resolution for signed-out pages (LUM-856). Workspace pages read the
 * member's saved preference; a public page has no user, so it takes an
 * explicit `?lang=` choice first, then the browser's Accept-Language, then en.
 *
 * Codes match the keys `IntlProviderWrapper` loads messages for.
 */
export const PUBLIC_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'en-GB',
  'en-AU',
  'es-ES',
  'es-419',
  'fr',
  'de',
  'ja',
  'ko',
  'hi',
  'ru',
  'vi',
  'id',
  'ms',
] as const

export type PublicLocale = (typeof PUBLIC_LOCALES)[number]

/** Each locale's name in its own language, for the language switcher. */
export const PUBLIC_LOCALE_NAMES: Record<PublicLocale, string> = {
  en: 'English (US)',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en-GB': 'English (UK)',
  'en-AU': 'English (Australia)',
  'es-ES': 'Español (España)',
  'es-419': 'Español (Latinoamérica)',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  ko: '한국어',
  hi: 'हिन्दी',
  ru: 'Русский',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
}

function matchTag(tag: string): PublicLocale | null {
  const lower = tag.trim().toLowerCase()
  if (!lower) return null
  const exact = PUBLIC_LOCALES.find(l => l.toLowerCase() === lower)
  if (exact) return exact

  const [lang, region = ''] = lower.split('-')
  if (lang === 'zh') {
    // Traditional script or a region that writes it; everything else Simplified.
    return ['hant', 'tw', 'hk', 'mo'].includes(region) ? 'zh-TW' : 'zh-CN'
  }
  if (lang === 'es') return region && region !== 'es' ? 'es-419' : 'es-ES'
  if (lang === 'en') {
    if (region === 'gb' || region === 'uk') return 'en-GB'
    if (region === 'au') return 'en-AU'
    return 'en'
  }
  return PUBLIC_LOCALES.find(l => l === lang) ?? null
}

/** Accept-Language tags ordered by q-value (stable for equal weights). */
function rankedTags(acceptLanguage: string): string[] {
  return acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';')
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return {
        tag: tag.trim(),
        weight: Number.isNaN(weight) ? 0 : weight,
        index,
      }
    })
    .filter(t => t.tag && t.tag !== '*' && t.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map(t => t.tag)
}

export function resolvePublicLocale(input: {
  lang?: string | null | undefined
  acceptLanguage?: string | null | undefined
}): PublicLocale {
  if (input.lang) {
    const chosen = matchTag(input.lang)
    if (chosen) return chosen
  }
  for (const tag of rankedTags(input.acceptLanguage ?? '')) {
    const matched = matchTag(tag)
    if (matched) return matched
  }
  return 'en'
}
