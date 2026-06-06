import {
  diffKeys,
  placeholder,
  syncLocale,
  serialize,
  discoverLocaleFiles,
} from '../scripts/i18n-sync-locales'

describe('diffKeys', () => {
  it('reports missing keys in en order and extra keys', () => {
    const en = { a: '1', b: '2', c: '3' }
    const locale = { a: 'x', c: 'y', z: 'old' }
    expect(diffKeys(en, locale)).toEqual({ missing: ['b'], extra: ['z'] })
  })

  it('returns empty arrays when in parity', () => {
    const en = { a: '1' }
    expect(diffKeys(en, { a: 'x' })).toEqual({ missing: [], extra: [] })
  })
})

describe('placeholder', () => {
  it('produces a grep-able [TODO:<locale>] marker with the en value', () => {
    expect(placeholder('fr', 'Cancel')).toBe('[TODO:fr] Cancel')
  })
})

describe('syncLocale', () => {
  it('appends missing keys as placeholders and preserves existing translations', () => {
    const en = { a: 'A', b: 'B', c: 'C' }
    const locale = { a: 'Annuler' }
    expect(syncLocale(en, locale, 'fr')).toEqual({
      a: 'Annuler',
      b: '[TODO:fr] B',
      c: '[TODO:fr] C',
    })
  })

  it('leaves extra keys intact', () => {
    const en = { a: 'A' }
    const locale = { a: 'Annuler', z: 'orphan' }
    expect(syncLocale(en, locale, 'fr')).toEqual({ a: 'Annuler', z: 'orphan' })
  })

  it('is idempotent', () => {
    const en = { a: 'A', b: 'B' }
    const once = syncLocale(en, { a: 'Annuler' }, 'fr')
    const twice = syncLocale(en, once, 'fr')
    expect(twice).toEqual(once)
  })

  it('does not mutate the input locale object', () => {
    const en = { a: 'A', b: 'B' }
    const locale = { a: 'Annuler' }
    syncLocale(en, locale, 'fr')
    expect(locale).toEqual({ a: 'Annuler' })
  })
})

describe('serialize', () => {
  it('emits 2-space JSON with a trailing newline', () => {
    expect(serialize({ a: '1' })).toBe('{\n  "a": "1"\n}\n')
  })
})

describe('discoverLocaleFiles', () => {
  it('lists locale json files excluding en.json', () => {
    const files = discoverLocaleFiles()
    expect(files).not.toContain('en.json')
    expect(files).toContain('fr.json')
    expect(files.every(f => f.endsWith('.json'))).toBe(true)
  })
})
