import type { IntlShape } from 'react-intl'
import en from '@/lib/i18n/en.json'
import { formatDurationMs } from '@/lib/datetime/duration'

// The run-duration shapes predate LUM-642; the localized helper must keep
// them byte-identical in `en` (zh behavior is pinned in lum642-duration-i18n).
// react-intl ships ESM jest can't load, so a minimal formatMessage stand-in
// reads the real en locale file.
const messages = en as Record<string, string>
const intl = {
  locale: 'en',
  formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) => {
    let msg = messages[id]
    if (msg === undefined) throw new Error(`missing i18n key: ${id}`)
    for (const [k, v] of Object.entries(values ?? {})) {
      msg = msg.replace(`{${k}}`, String(v))
    }
    return msg
  },
} as unknown as IntlShape

describe('formatDurationMs', () => {
  it('renders sub-second as ms', () => {
    expect(formatDurationMs(intl, 0)).toBe('0ms')
    expect(formatDurationMs(intl, 999)).toBe('999ms')
  })
  it('renders under a minute as seconds', () => {
    expect(formatDurationMs(intl, 1000)).toBe('1s')
    expect(formatDurationMs(intl, 59_000)).toBe('59s')
  })
  it('renders whole minutes without a seconds part', () => {
    expect(formatDurationMs(intl, 60_000)).toBe('1m')
    expect(formatDurationMs(intl, 120_000)).toBe('2m')
  })
  it('renders minutes and seconds', () => {
    expect(formatDurationMs(intl, 17_692_000)).toBe('294m 52s')
  })
})
