/**
 * @jest-environment node
 *
 * LUM-1088 — one spelling for dates, timestamps, durations, token counts,
 * empty values and empty states across the CLI.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  NONE,
  emptyState,
  fmtCalendarDay,
  fmtCount,
  fmtDay,
  fmtTimestamp,
  fmtTokens,
  formatDuration,
  formatDurationSec,
  orNone,
} from '../../cli/src/lib/format'
import { note, hint } from '../../cli/src/lib/feedback'

const ROOT = path.resolve(__dirname, '../..')

describe('date helpers (in-process, timezone-independent)', () => {
  it('fmtCalendarDay keeps the stored UTC day and maps absent to NONE', () => {
    expect(fmtCalendarDay('2026-06-01T00:00:00.000Z')).toBe('2026-06-01')
    expect(fmtCalendarDay(null)).toBe(NONE)
    expect(fmtCalendarDay(undefined)).toBe(NONE)
  })

  it('fmtDay / fmtTimestamp render a local instant in local wall-clock time', () => {
    // Built from local components, so the expectation holds in every zone.
    const iso = new Date(2026, 8, 15, 9, 5).toISOString()
    expect(fmtDay(iso)).toBe('2026-09-15')
    expect(fmtTimestamp(iso)).toBe('2026-09-15 09:05')
  })

  it('fmtDay / fmtTimestamp map absent or unparsable input to NONE', () => {
    expect(fmtDay(null)).toBe(NONE)
    expect(fmtTimestamp(undefined)).toBe(NONE)
    expect(fmtTimestamp('not a date')).toBe(NONE)
  })
})

/** Run the real helpers in a child process pinned to `tz`. */
function inZone(tz: string): Record<string, string> {
  const code = [
    "import { fmtCalendarDay, fmtDay, fmtTimestamp } from './cli/src/lib/format'",
    'console.log(JSON.stringify({',
    "  calendar: fmtCalendarDay('2026-06-01T00:00:00.000Z'),",
    "  day: fmtDay('2026-06-01T00:00:00.000Z'),",
    "  ts: fmtTimestamp('2026-06-01T00:30:00.000Z'),",
    '}))',
  ].join('\n')
  const out = execFileSync(
    path.join(ROOT, 'node_modules/.bin/tsx'),
    ['-e', code],
    { cwd: ROOT, env: { ...process.env, TZ: tz }, encoding: 'utf8' }
  )
  return JSON.parse(out.trim()) as Record<string, string>
}

describe('date helpers across timezones (child process with TZ set)', () => {
  it('a calendar day never shifts, west or east of UTC', () => {
    expect(inZone('America/Los_Angeles').calendar).toBe('2026-06-01')
    expect(inZone('Asia/Shanghai').calendar).toBe('2026-06-01')
  })

  it('a timestamp is shown in the local zone', () => {
    expect(inZone('America/Los_Angeles')).toMatchObject({
      day: '2026-05-31',
      ts: '2026-05-31 17:30',
    })
    expect(inZone('Asia/Shanghai')).toMatchObject({
      day: '2026-06-01',
      ts: '2026-06-01 08:30',
    })
    expect(inZone('UTC').ts).toBe('2026-06-01 00:30')
  })
})

describe('durations', () => {
  it('one shape: s under a minute, m under an hour, then h + m', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(14 * 60_000)).toBe('14m')
    expect(formatDuration((2 * 60 + 14) * 60_000)).toBe('2h 14m')
    expect(formatDuration(3 * 3_600_000)).toBe('3h')
  })

  it('formatDurationSec is the same shape for seconds (task status cost)', () => {
    expect(formatDurationSec(0)).toBe('0s')
    expect(formatDurationSec(12)).toBe('12s')
    expect(formatDurationSec(2 * 3600 + 14 * 60)).toBe('2h 14m')
    expect(formatDurationSec(2 * 3600 + 14 * 60)).toBe(
      formatDuration((2 * 3600 + 14 * 60) * 1000)
    )
  })
})

describe('token counts', () => {
  it('fmtTokens is compact for one-line summaries', () => {
    expect(fmtTokens(1_200_000)).toBe('1.2M')
    expect(fmtTokens(850_000)).toBe('850K')
    expect(fmtTokens(812)).toBe('812')
  })

  it('fmtCount is exact with thousands separators, rounding fractions', () => {
    expect(fmtCount(1_234_567)).toBe('1,234,567')
    expect(fmtCount(999)).toBe('999')
    expect(fmtCount(1234.6)).toBe('1,235')
    expect(fmtCount(-12_000)).toBe('-12,000')
  })
})

describe('empty values and empty states', () => {
  it('NONE is the one absent-value placeholder', () => {
    expect(NONE).toBe('-')
    expect(orNone(null)).toBe('-')
    expect(orNone('')).toBe('-')
    expect(orNone('x')).toBe('x')
  })

  it('emptyState is a sentence with a period, optionally scoped', () => {
    expect(emptyState('tags')).toBe('No tags.')
    expect(emptyState('artifacts', 'LUM-42')).toBe('No artifacts on LUM-42.')
  })
})

describe('Note: vs Hint: prefixes', () => {
  it('note() is a precision caveat, hint() is advice', () => {
    expect(note('x')).toBe('Note: x')
    expect(hint('x')).toBe('Hint: x')
  })
})

function commandSources(): Array<[string, string]> {
  const dir = path.join(ROOT, 'cli/src/commands')
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts'))
    .map(f => [f, readFileSync(path.join(dir, f), 'utf8')])
}

describe('sweep over cli/src/commands', () => {
  it('no command slices an ISO string to a day — the helpers own that', () => {
    const re = new RegExp('slice\\(0, *1[06]\\)')
    const hits = commandSources()
      .filter(([, src]) => re.test(src))
      .map(([f]) => f)
    expect(hits).toEqual([])
  })

  it('the listed HTTP-failure sites go through errHttp / httpFailed', () => {
    const files = [
      'crossing-disposition.ts',
      'crossing-explain.ts',
      'outcome.ts',
      'priority.ts',
      'milestone-add.ts',
      'milestone-remove.ts',
      'milestone-triage.ts',
      'sprint-add.ts',
      'sprint-remove.ts',
      'cost.ts',
    ]
    // A hand-rolled "(HTTP <status>)" literal outside lib/errors.ts.
    const handRolled = new RegExp('\\(HTTP \\$\\{')
    const src = new Map(commandSources())
    for (const f of files) {
      expect([f, handRolled.test(src.get(f) ?? '')]).toEqual([f, false])
    }
  })
})
