/**
 * @jest-environment node
 *
 * LUM-1097 — server-side message lookup (Slack copy) and the `slack.msg.*`
 * catalogue contract: every locale fills the same `{placeholders}` as en,
 * never uses ICU plural/select syntax (the server formatter does not parse
 * it), and the non-Latin locales are real translations, not English.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  formatServerMessage,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  toSupportedLocale,
} from '@/lib/i18n/server-messages'

const dir = join(__dirname, '..', '..', '..', 'lib', 'i18n')
const read = (f: string) =>
  JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, string>
const en = read('en.json')
const slackKeys = Object.keys(en).filter(
  k => k.startsWith('slack.msg.') || k.startsWith('slack.event.')
)
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('formatServerMessage', () => {
  it('fills {placeholders} in the requested locale', () => {
    expect(
      formatServerMessage('en', 'slack.msg.cmd.moved', {
        task: 'ENG-1',
        status: 'Done',
      })
    ).toBe('ENG-1 moved to Done')
    expect(
      formatServerMessage('zh-CN', 'slack.msg.cmd.moved', {
        task: 'ENG-1',
        status: '已完成',
      })
    ).toBe('ENG-1 已移至 已完成')
  })

  it('leaves a placeholder with no value visible', () => {
    expect(formatServerMessage('en', 'slack.msg.cmd.moved', {})).toBe(
      '{task} moved to {status}'
    )
  })

  it('returns the id for an unknown key', () => {
    expect(formatServerMessage('fr', 'slack.msg.nope')).toBe('slack.msg.nope')
  })

  it('does not re-read placeholders inside an inserted value', () => {
    expect(
      formatServerMessage('en', 'slack.msg.cmd.moved', {
        task: '{status}',
        status: 'Done',
      })
    ).toBe('{status} moved to Done')
  })
})

describe('toSupportedLocale', () => {
  it('keeps a supported code and replaces anything else', () => {
    expect(toSupportedLocale('ja')).toBe('ja')
    expect(toSupportedLocale('zh')).toBe('en')
    expect(toSupportedLocale(null, 'de')).toBe('de')
    expect(isSupportedLocale('es-419')).toBe(true)
    expect(isSupportedLocale('xx')).toBe(false)
  })

  it('lists the same codes the member preference accepts', () => {
    expect(SUPPORTED_LOCALES).toContain('en')
    expect(SUPPORTED_LOCALES).toContain('zh-CN')
    expect(SUPPORTED_LOCALES).toHaveLength(16)
  })
})

describe('slack.* catalogue contract', () => {
  it('covers the Slack copy', () => {
    expect(slackKeys.length).toBeGreaterThanOrEqual(80)
  })

  const files = readdirSync(dir).filter(
    f => f.endsWith('.json') && f !== 'en.json'
  )

  it.each(files)('%s uses the same placeholders as en', file => {
    const loc = read(file)
    const mismatched = slackKeys.filter(
      k =>
        JSON.stringify(placeholders(loc[k] ?? '')) !==
        JSON.stringify(placeholders(en[k] ?? ''))
    )
    expect(mismatched).toEqual([])
  })

  it.each(['en.json', ...files])('%s has no ICU plural/select', file => {
    const loc = read(file)
    const icu = slackKeys.filter(k => /\{\w+,/.test(loc[k] ?? ''))
    expect(icu).toEqual([])
  })

  it.each([
    'zh-CN.json',
    'zh-TW.json',
    'ja.json',
    'ko.json',
    'hi.json',
    'ru.json',
  ])('%s translates every Slack string', file => {
    const loc = read(file)
    // Only bare product terms may stay as-is.
    const english = slackKeys.filter(
      k => loc[k] === en[k] && !/^PR |^View PR/.test(en[k] ?? '')
    )
    expect(english).toEqual([])
  })
})
