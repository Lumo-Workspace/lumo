import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  dayKeyToLocalDate,
  localDateToDayKey,
} from '@/lib/datetime/calendar-day'

describe('dayKeyToLocalDate', () => {
  it('maps a day key to local midnight of that day', () => {
    const d = dayKeyToLocalDate('2026-07-01')!
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2026, 6, 1, 0,
    ])
  })

  it('reads the day part of a stored ISO timestamp (UTC midnight)', () => {
    const d = dayKeyToLocalDate('2026-06-01T00:00:00.000Z')!
    expect(localDateToDayKey(d)).toBe('2026-06-01')
  })

  it('returns undefined for empty or malformed input', () => {
    expect(dayKeyToLocalDate('')).toBeUndefined()
    expect(dayKeyToLocalDate(null)).toBeUndefined()
    expect(dayKeyToLocalDate(undefined)).toBeUndefined()
    expect(dayKeyToLocalDate('June 1')).toBeUndefined()
  })
})

describe('localDateToDayKey', () => {
  it('keys a picked local date by its own calendar day', () => {
    expect(localDateToDayKey(new Date(2026, 0, 9))).toBe('2026-01-09')
    expect(localDateToDayKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('round-trips every day of a year', () => {
    for (let i = 0; i < 365; i++) {
      const day = new Date(2026, 0, 1 + i)
      const key = localDateToDayKey(day)
      expect(localDateToDayKey(dayKeyToLocalDate(key)!)).toBe(key)
    }
  })
})

/**
 * `process.env.TZ` cannot be changed inside jest's VM, so run the real module
 * in a child process with the zone set before Node starts. The child does
 * what the picker does: the calendar hands back local midnight of the clicked
 * day, which is keyed for the API — and the stored value is shown selected.
 */
describe('a day picked in another time zone saves as the same calendar day', () => {
  const root = path.resolve(__dirname, '../../..')
  const script = `
    import('./lib/datetime/calendar-day.ts').then(m => {
      const clicked = new Date(2026, 6, 1) // the calendar's Jul 1 cell
      const saved = m.localDateToDayKey(clicked)
      const shown = m.dayKeyToLocalDate('2026-07-01T00:00:00.000Z')
      process.stdout.write(JSON.stringify({
        offset: clicked.getTimezoneOffset(),
        saved,
        shownDay: shown.getDate(),
        shownMonth: shown.getMonth(),
      }))
    })
  `
  it.each([
    ['America/Los_Angeles', 420],
    ['Pacific/Honolulu', 600],
    ['Asia/Shanghai', -480],
  ])('%s', (tz, expectedOffset) => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: root,
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    })
    expect(run.stderr).toBe('')
    const out = JSON.parse(run.stdout) as {
      offset: number
      saved: string
      shownDay: number
      shownMonth: number
    }
    expect(out.offset).toBe(expectedOffset)
    expect(out.saved).toBe('2026-07-01')
    expect([out.shownMonth, out.shownDay]).toEqual([6, 1])
  })
})
