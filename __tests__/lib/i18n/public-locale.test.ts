import { MESSAGES } from '@/lib/i18n/messages'
import { PUBLIC_LOCALES, resolvePublicLocale } from '@/lib/i18n/public-locale'

describe('resolvePublicLocale', () => {
  it('prefers an explicit ?lang= choice', () => {
    expect(
      resolvePublicLocale({ lang: 'ja', acceptLanguage: 'fr-FR,fr;q=0.9' })
    ).toBe('ja')
  })

  it('ignores an unsupported ?lang= and falls back to Accept-Language', () => {
    expect(resolvePublicLocale({ lang: 'xx', acceptLanguage: 'de-DE' })).toBe(
      'de'
    )
  })

  it('honours Accept-Language q-values', () => {
    expect(
      resolvePublicLocale({ acceptLanguage: 'fr;q=0.5, ko;q=0.9, *;q=1' })
    ).toBe('ko')
  })

  it('maps regional and script variants onto the supported set', () => {
    const cases: [string, string][] = [
      ['zh-Hant-TW', 'zh-TW'],
      ['zh-HK', 'zh-TW'],
      ['zh', 'zh-CN'],
      ['zh-SG', 'zh-CN'],
      ['es-MX', 'es-419'],
      ['es', 'es-ES'],
      ['en-GB', 'en-GB'],
      ['en-AU', 'en-AU'],
      ['en-CA', 'en'],
      ['pt-BR', 'en'],
    ]
    for (const [tag, want] of cases)
      expect([tag, resolvePublicLocale({ acceptLanguage: tag })]).toEqual([
        tag,
        want,
      ])
  })

  it('defaults to en with no signal', () => {
    expect(resolvePublicLocale({})).toBe('en')
  })

  it('only returns locales that have a message catalogue', () => {
    expect(PUBLIC_LOCALES.filter(l => !MESSAGES[l])).toEqual([])
  })
})
