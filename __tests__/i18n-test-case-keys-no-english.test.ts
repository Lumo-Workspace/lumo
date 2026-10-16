/**
 * LUM-1011 follow-up: the test-case keys added with the Record tab's Test
 * cases section must be translated in every non-English locale — never left
 * as the English text, and never with the English term "test case" (vi.json
 * shipped "Test case" while its existing keys say "ca kiểm thử").
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(__dirname, '..', 'lib', 'i18n')
const read = (f: string) =>
  JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, string>
const en = read('en.json')
const keys = Object.keys(en).filter(
  k =>
    k.startsWith('testCases.section.') ||
    k.startsWith('testCases.report.') ||
    k.startsWith('testCases.field.actual') ||
    k.startsWith('testCases.field.stepResults') ||
    k.startsWith('record.gate.tests.')
)
const locales = readdirSync(dir).filter(
  f => f.endsWith('.json') && !f.startsWith('en')
)

describe('test-case keys are translated, not English fallbacks', () => {
  it('covers the keys it is meant to', () => {
    expect(keys.length).toBeGreaterThanOrEqual(20)
  })

  it.each(locales)('%s', file => {
    const loc = read(file)
    const english = keys.filter(
      k => loc[k] === en[k] || /test case/i.test(loc[k] ?? '')
    )
    expect(english).toEqual([])
  })
})
