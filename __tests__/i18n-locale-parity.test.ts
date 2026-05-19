// __tests__/i18n-locale-parity.test.ts
import en from '../lib/i18n/en.json'
import zhCN from '../lib/i18n/zh-CN.json'
import zhTW from '../lib/i18n/zh-TW.json'
import enGB from '../lib/i18n/en-GB.json'
import enAU from '../lib/i18n/en-AU.json'
import es from '../lib/i18n/es.json'
import es419 from '../lib/i18n/es-419.json'
import fr from '../lib/i18n/fr.json'
import de from '../lib/i18n/de.json'
import ja from '../lib/i18n/ja.json'
import ko from '../lib/i18n/ko.json'
import hi from '../lib/i18n/hi.json'
import ru from '../lib/i18n/ru.json'
import vi from '../lib/i18n/vi.json'
import id from '../lib/i18n/id.json'
import ms from '../lib/i18n/ms.json'

const LOCALES: Record<string, Record<string, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-GB': enGB,
  'en-AU': enAU,
  es,
  'es-419': es419,
  fr,
  de,
  ja,
  ko,
  hi,
  ru,
  vi,
  id,
  ms,
}

describe('i18n locale parity', () => {
  const enKeys = Object.keys(en).sort()

  for (const [locale, messages] of Object.entries(LOCALES)) {
    test(`${locale} has the same key set as en.json`, () => {
      const localeKeys = Object.keys(messages).sort()
      const missing = enKeys.filter(k => !(k in messages))
      const extra = localeKeys.filter(k => !(k in en))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })
  }

  for (const [locale, messages] of Object.entries(LOCALES)) {
    test(`${locale} provides non-empty values`, () => {
      const empties = Object.entries(messages)
        .filter(([, v]) => !v || v.trim() === '')
        .map(([k]) => k)
      expect(empties).toEqual([])
    })
  }
})
