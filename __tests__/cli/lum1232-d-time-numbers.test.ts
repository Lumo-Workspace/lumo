/**
 * @jest-environment node
 */
/**
 * LUM-1232 batch D — time and numbers (docs/cli-output-conventions.md T-1–T-3,
 * N-1–N-4, E-1, E-2, V-1, S-1). Every assertion here fails on the 1.125.2
 * output: relative / zone-less / raw-ISO times, `145.7M (145.7M tok)`,
 * `1301.1h`, `49.2%`, `ON-TRACK`, `merged`, `not metered`, `!` warnings.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import * as format from '../../cli/src/lib/format'
import {
  fmtDayRange,
  fmtEnum,
  fmtInstant,
  fmtPercent,
  fmtTimestamp,
  formatDuration,
  formatDurationHours,
  utcOffsetLabel,
} from '../../cli/src/lib/format'
import { enumColor } from '../../cli/src/lib/ui'
import { formatHealth } from '../../cli/src/lib/milestone-labels'
import { avgCompletionLabel } from '../../cli/src/lib/overview-format'
import {
  formatAuditList,
  type AuditListPage,
} from '../../cli/src/commands/audit-list'
import {
  formatInbox,
  type InboxNotification,
} from '../../cli/src/commands/inbox-list'
import { formatCommentThread } from '../../cli/src/commands/task-comment-list'
import {
  formatRunReport,
  type RunReport,
} from '../../cli/src/commands/task-runs'
import { formatTaskShow } from '../../cli/src/commands/task-show'
import { buildAgentRunReport } from '@/lib/services/agent-run-report.service'
import { TIMELINE } from '../helpers/lum1188-agent-runs-timeline'

const ROOT = path.join(__dirname, '..', '..')
const TSX = path.join(ROOT, 'node_modules/.bin/tsx')
const TTY_RE = /^\d{4}-\d\d-\d\d \d\d:\d\d [+-]\d\d:\d\d$/
const ESC = '\u001b'

/** Read a printed local time with offset back into an instant. */
function parseTty(s: string): number {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d) ([+-]\d\d:\d\d)$/.exec(s)
  if (!m) throw new Error(`not a TTY timestamp: ${s}`)
  return new Date(`${m[1]}T${m[2]}:00${m[3]}`).getTime()
}

describe('T-1 / T-2 — fmtInstant: absolute time only', () => {
  const iso = '2026-10-16T22:24:30.329Z'

  it('pipe form: UTC ISO 8601 to the second, trailing Z', () => {
    expect(fmtInstant(iso, { tty: false })).toBe('2026-10-16T22:24:30Z')
  })

  it('terminal form: local time + UTC offset that reads back to the same minute', () => {
    const out = fmtInstant(iso, { tty: true })
    expect(out).toMatch(TTY_RE)
    expect(parseTty(out)).toBe(new Date('2026-10-16T22:24:00Z').getTime())
  })

  it('fmtTimestamp is the same formatter; absent / garbage → -', () => {
    expect(fmtTimestamp(iso, { tty: false })).toBe(
      fmtInstant(iso, { tty: false })
    )
    expect(fmtInstant(null)).toBe('-')
    expect(fmtInstant('nope', { tty: true })).toBe('-')
  })

  it('utcOffsetLabel spells the offset as ±HH:MM', () => {
    expect(utcOffsetLabel(new Date(iso))).toMatch(/^[+-]\d\d:\d\d$/)
  })

  it('relativeTime is gone from the shared formatters', () => {
    expect('relativeTime' in format).toBe(false)
  })
})

/** Run fmtInstant in a child process pinned to `tz` (TZ is read at startup). */
function inZone(tz: string): { tty: string; pipe: string } {
  const code = [
    "import { fmtInstant } from './cli/src/lib/format'",
    "const iso = '2026-10-16T22:24:00.000Z'",
    'console.log(JSON.stringify({ tty: fmtInstant(iso, { tty: true }), pipe: fmtInstant(iso, { tty: false }) }))',
  ].join('\n')
  const out = execFileSync(TSX, ['-e', code], {
    cwd: ROOT,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim()) as { tty: string; pipe: string }
}

describe('T-2 across zones (child process with TZ set)', () => {
  it('shows the local wall clock with the offset in force at that instant', () => {
    expect(inZone('Australia/Sydney')).toEqual({
      tty: '2026-10-17 09:24 +11:00',
      pipe: '2026-10-16T22:24:00Z',
    })
    expect(inZone('Asia/Shanghai').tty).toBe('2026-10-17 06:24 +08:00')
    expect(inZone('America/Los_Angeles').tty).toBe('2026-10-16 15:24 -07:00')
    expect(inZone('UTC').tty).toBe('2026-10-16 22:24 +00:00')
  })
})

/**
 * The default (no `tty` option) follows stdout. A real pseudo-terminal from
 * `script(1)` proves the terminal branch; a plain pipe proves the other.
 */
describe('T-1 / T-2 — default follows stdout: script(1) TTY vs pipe', () => {
  // The program lives in a file (no `-e`), so script(1) gets a plain argv on
  // macOS and a single-line `-c` command on Linux — no quoting of newlines.
  let program = ''
  beforeAll(() => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lum1232-tty-'))
    program = path.join(dir, 'print-time.ts')
    const lib = path.join(ROOT, 'cli/src/lib/format')
    writeFileSync(
      program,
      `import { fmtTimestamp } from ${JSON.stringify(lib)}\n` +
        "process.stdout.write('[' + fmtTimestamp('2026-10-16T22:24:00.000Z') + ']\\n')\n"
    )
  })
  afterAll(() =>
    rmSync(path.dirname(program), { recursive: true, force: true })
  )
  const env = { ...process.env, TZ: 'Australia/Sydney' }

  it('piped stdout prints UTC with Z', () => {
    const out = execFileSync(TSX, [program], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
    })
    expect(out).toContain('[2026-10-16T22:24:00Z]')
  })

  it('a pseudo-terminal prints local time with its offset', () => {
    const args =
      process.platform === 'darwin'
        ? ['-q', '/dev/null', TSX, program]
        : ['-qec', `${TSX} ${program}`, '/dev/null']
    const out = execFileSync('script', args, {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(out).toContain('[2026-10-17 09:24 +11:00]')
  })
})

describe('T-3 — calendar-day ranges', () => {
  it('start → end, never `..` or parentheses', () => {
    expect(
      fmtDayRange('2026-10-05T00:00:00.000Z', '2026-10-18T00:00:00.000Z')
    ).toBe('2026-10-05 → 2026-10-18')
    expect(fmtDayRange(null, undefined)).toBe('- → -')
  })
})

describe('D2–D5 — audit / inbox / comments print absolute times', () => {
  const page: AuditListPage = {
    events: [
      {
        id: 'ev_1',
        createdAt: '2026-10-04T15:54:12.000Z',
        action: 'member.role_changed',
        actorType: 'MEMBER',
        actorId: 'user_1',
        actorName: 'Alice Chen',
        actorEmail: 'alice@example.com',
        source: 'WEB',
        targetType: 'member',
        targetId: 'm_2',
        ip: '203.0.113.9',
      },
    ],
    nextCursor: null,
  } as AuditListPage

  it('audit list: UTC Z in a pipe, local + offset on a TTY', () => {
    const pipe = formatAuditList(page, {}, { tty: false, color: false })
    expect(pipe.split('\n')[0]).toMatch(
      /^2026-10-04T15:54:12Z  member\.role_changed/
    )
    const tty = formatAuditList(
      page,
      {},
      { tty: true, color: false, width: 200 }
    )
    const row = tty.split('\n')[1] ?? ''
    expect(row.slice(0, 23)).toMatch(TTY_RE)
  })

  const note = {
    id: 'n1',
    type: 'TASK_ASSIGNED',
    read: true,
    requiresAction: false,
    actionTakenAt: null,
    createdAt: '2026-10-16T09:00:00.000Z',
    actor: { name: 'Alice Chen' },
    task: { title: 'Fix login', number: 7, teamIdentifier: 'LUM' },
    sprint: null,
    project: null,
    milestone: null,
    document: null,
    commentPreview: null,
  } as unknown as InboxNotification

  it('inbox: the notification time is absolute', () => {
    expect(
      formatInbox({ notifications: [note], unreadCount: 0 }, { tty: false })
    ).toContain('  2026-10-16T09:00:00Z  Alice Chen assigned you to LUM-7')
    const tty = formatInbox(
      { notifications: [note], unreadCount: 0 },
      { tty: true }
    )
    expect(tty).toMatch(/ \d{4}-\d\d-\d\d \d\d:\d\d [+-]\d\d:\d\d  Alice Chen/)
  })

  it('comments: absolute time; a missing author prints - (V-1), not unknown', () => {
    const out = formatCommentThread(
      [
        {
          id: 'cmabcdefgh',
          authorActorId: null,
          body: 'hi',
          createdAt: '2026-10-03T15:59:00.000Z',
        },
      ],
      { full: true }
    )
    expect(out).toMatch(
      / · - · (2026-10-03T15:59:00Z|\d{4}-\d\d-\d\d \d\d:\d\d [+-]\d\d:\d\d)/
    )
    expect(out).not.toContain('unknown')
  })
})

describe('N-1 — a number appears once', () => {
  const base = buildAgentRunReport(TIMELINE, {
    sessionCount: 1,
    forecast: null,
    tokenCost: {
      forecast: null,
      actual: 145_700_000,
      deltaPct: null,
      band: null,
    },
    iterations: { forecast: null, actual: 1, deltaPct: null, band: null },
    interactionRounds: {
      forecast: null,
      actual: 1,
      deltaPct: null,
      band: null,
    },
    totalDuration: { forecast: null, actual: null, deltaPct: null, band: null },
  } as never) as unknown as RunReport

  it('one model: `Tokens: 145.7M`, not `145.7M (145.7M tok)`', () => {
    const one: RunReport = {
      ...base,
      totals: {
        ...base.totals,
        total: 145_700_000,
        byModel: [{ ...base.totals.byModel[0]!, total: 145_700_000 }],
      },
    }
    const text = formatRunReport('LUM-1185', one)
    expect(text).toContain('Tokens: 145.7M · ')
    expect(text).not.toMatch(/Tokens: 145\.7M \(/)
  })
})

describe('N-3 — durations in s / m / h, never days', () => {
  it('stays in hours and minutes from 48 hours on — never days (ruling 2026-10-18)', () => {
    expect(formatDuration(47 * 3_600_000)).toBe('47h')
    expect(formatDuration(48 * 3_600_000)).toBe('48h 0m')
    expect(formatDuration((80 * 60 + 19) * 60_000)).toBe('80h 19m')
    expect(formatDuration((54 * 24 + 5) * 3_600_000)).toBe('1301h 0m')
    expect(formatDurationHours(1301.1)).toBe('1301h 6m')
    expect(formatDurationHours(null)).toBe('-')
  })

  it('project overview: Avg completion is never fractional hours (D10)', () => {
    expect(avgCompletionLabel(1301.1)).toBe('1301h 6m')
    expect(avgCompletionLabel(null)).toBe('-')
  })
})

describe('N-4 — percentages', () => {
  it('whole numbers; one decimal only where rounding would say 0% or 100%', () => {
    expect(fmtPercent(49.2)).toBe('49%')
    expect(fmtPercent(0.4)).toBe('0.4%')
    expect(fmtPercent(99.8)).toBe('99.8%')
    expect(fmtPercent(100)).toBe('100%')
    expect(fmtPercent(0)).toBe('0%')
    // Never rounds a non-zero / non-full share onto the edge.
    expect(fmtPercent(0.04)).toBe('<0.1%')
    expect(fmtPercent(99.97)).toBe('>99.9%')
  })
})

describe('E-1 — enums print as UPPER_SNAKE (D12, D13)', () => {
  it('fmtEnum folds case and hyphens', () => {
    expect(fmtEnum('merged')).toBe('MERGED')
    expect(fmtEnum('on-track')).toBe('ON_TRACK')
    expect(fmtEnum('IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(fmtEnum(null)).toBe('-')
  })

  it('milestone health uses ON_TRACK / AT_RISK', () => {
    expect(formatHealth('on-track')).toBe('ON_TRACK')
    expect(formatHealth('at-risk')).toBe('AT_RISK')
  })
})

describe('E-2 — enum colour adds, never changes piped bytes (D14)', () => {
  it('colours by meaning on a TTY and is the identity with colour off', () => {
    expect(enumColor('DONE', true)).toBe(`${ESC}[32mDONE${ESC}[39m`)
    expect(enumColor('FAIL', true)).toBe(`${ESC}[31mFAIL${ESC}[39m`)
    expect(enumColor('IN_REVIEW', true)).toBe(`${ESC}[33mIN_REVIEW${ESC}[39m`)
    expect(enumColor('TODO', true)).toBe('TODO')
    expect(enumColor('DONE', false)).toBe('DONE')
  })

  const task = {
    identifier: 'LUM-1',
    title: 'T',
    status: 'DONE',
    priority: 'HIGH',
    project: { name: 'Lumo' },
    assignee: null,
    url: 'https://example.test/LUM-1',
    description: '',
  }

  it('task show colours Status on a TTY only', () => {
    const coloured = formatTaskShow(task as never, { color: true })
    expect(coloured).toContain(`${ESC}[32mDONE${ESC}[39m`)
    const plain = formatTaskShow(task as never, { color: false })
    expect(plain).toMatch(/^Status:\s+DONE$/m)
    expect(plain).not.toContain(ESC)
  })
})
