// __tests__/i18n-extract-toast-parity.test.ts
//
// Guards the doc.extract.* toast keys rendered by DescriptionEditor.tsx
// (the `intl.formatMessage` toasts in handleExtractCommit / handleExtractError).
// The generic locale-parity test only checks key-set parity + non-empty values;
// it cannot catch a non-English locale that silently ships the English string as
// a fallback. These toasts are user-facing and CLAUDE.md forbids English fallback
// for non-English locales, so we assert each non-English value is a real
// translation (≠ the English source string). [LUM-214]
import en from '../lib/i18n/en.json'
import zhCN from '../lib/i18n/zh-CN.json'
import zhTW from '../lib/i18n/zh-TW.json'
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

// Keys referenced via intl.formatMessage in DescriptionEditor.tsx's extract toasts.
// Keep in sync with that component if a toast is added or renamed.
const EXTRACT_TOAST_KEYS = [
  'doc.extract.undo_warning',
  'doc.extract.toast.success',
  'doc.extract.toast.skipped_empty',
  'doc.extract.toast.truncated',
  'doc.extract.toast.error_no_project',
  'doc.extract.toast.error_unknown',
] as const

// Non-English locales only — en-GB/en-AU are English variants whose values may
// legitimately equal en.json, so they are excluded from the anti-fallback check.
const NON_ENGLISH_LOCALES: Record<string, Record<string, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
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

const enMessages = en as Record<string, string>

describe('doc.extract toast i18n', () => {
  test('every extract toast key exists in en.json', () => {
    const missing = EXTRACT_TOAST_KEYS.filter(k => !(k in enMessages))
    expect(missing).toEqual([])
  })

  for (const [locale, messages] of Object.entries(NON_ENGLISH_LOCALES)) {
    test(`${locale} translates every extract toast key (no English fallback)`, () => {
      const problems: Array<{ key: string; reason: string }> = []
      for (const key of EXTRACT_TOAST_KEYS) {
        const value = messages[key]
        if (value == null || value.trim() === '') {
          problems.push({ key, reason: 'missing or empty' })
        } else if (value === enMessages[key]) {
          problems.push({ key, reason: 'identical to English (fallback)' })
        }
      }
      expect(problems).toEqual([])
    })
  }
})
