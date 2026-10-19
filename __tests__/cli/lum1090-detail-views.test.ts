/**
 * @jest-environment node
 *
 * LUM-1090 — `task show`, `milestone show`, `sprint show`, `session status`
 * (and the `task history` table) laid out with the LUM-1086 / LUM-1091
 * grammar: `Label:  value` rows padded to the widest label, headed sections,
 * descriptions wrapped and indented as a whole, task tables with a header row
 * on a TTY, one blocker per line, colour only when the caller turns it on.
 */
import {
  formatMilestoneShow,
  type MilestoneShowData,
} from '@/cli/src/commands/milestone-show'
import { formatSprintShow } from '@/cli/src/commands/sprint-show'
import { formatTaskShow } from '@/cli/src/commands/task-show'
import {
  formatHistory,
  type ActivityEntry,
} from '@/cli/src/commands/task-history'
import { formatSessionStatus } from '@/cli/src/commands/session-status'
import { taskTableSection } from '@/cli/src/lib/detail-layout'
import { fieldLines, indentLines } from '@/cli/src/lib/report-layout'
import { stringWidth } from '@/cli/src/lib/ui'
import type { TaskRow } from '@/cli/src/lib/format'

const ESC = '\u001b'

const task: TaskRow = {
  id: 't-1',
  number: 42,
  title: 'Fix Slack OAuth redirect',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  teamIdentifier: 'LUM',
  project: { id: 'p-1', name: 'Lumo' },
}

const milestone: MilestoneShowData = {
  id: 'm-1',
  name: 'Q3 Launch',
  completedAt: null,
  startDate: '2026-06-01T00:00:00.000Z',
  targetDate: '2026-08-31T00:00:00.000Z',
  archivedAt: null,
  description: null,
  projectName: 'Lumo',
  taskCounts: { BACKLOG: 2, TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 0, DONE: 3 },
  health: 'at-risk',
}

const sprint = {
  id: 'sp-1',
  number: 3,
  name: 'Sprint 3',
  status: 'ACTIVE',
  startDate: '2026-06-01T00:00:00.000Z',
  endDate: '2026-06-14T23:59:59.000Z',
  startedAt: '2026-06-01T09:00:00.000Z',
  closedAt: null as string | null,
  team: { id: 't-1', name: 'Engineering' },
}

/** Column where the value starts on every `Label:  value` row of `lines`. */
function valueColumns(lines: string[]): number[] {
  return lines
    .filter(l => /^[A-Z][A-Za-z ]*:  +\S/.test(l))
    .map(l => (l.match(/^[A-Z][A-Za-z ]*: +/) ?? [''])[0].length)
}

describe('LUM-1090 — one label width per detail view', () => {
  it('milestone show: every header row puts its value in the same column', () => {
    const head = formatMilestoneShow(milestone, [])
      .split('\n\n')[0]!
      .split('\n')
    expect(head).toHaveLength(8)
    expect(new Set(valueColumns(head))).toEqual(new Set([12]))
  })

  it('sprint show: header and Progress rows share one value column', () => {
    const out = formatSprintShow(sprint, { done: 4, total: 10 }, [])
    const rows = out.split('\nBlockers')[0]!.split('\nTasks')[0]!.split('\n')
    expect(new Set(valueColumns(rows))).toEqual(new Set([11]))
    expect(out).toContain('Closed:    -\n\nProgress:  4/10')
  })

  it('task show: header line, then rows in one value column', () => {
    const out = formatTaskShow({
      id: 't',
      identifier: 'LUM-42',
      title: 'Fix it',
      status: 'TODO',
      priority: 'LOW',
      description: null,
      url: 'https://lumo.test/LUM-42',
      project: { id: 'p', name: 'Lumo' },
      assignee: null,
    })
    expect(out).toBe(
      [
        'LUM-42  Fix it',
        'Status:    TODO',
        'Priority:  LOW',
        'Project:   Lumo',
        'Assignee:  -',
        'URL:       https://lumo.test/LUM-42',
      ].join('\n')
    )
  })

  it('task show: a URL too long for its row moves under the label unbroken', () => {
    const url = `https://lumo.test/${'x'.repeat(120)}`
    const out = formatTaskShow({
      id: 't',
      identifier: 'LUM-42',
      title: 'Fix it',
      status: 'TODO',
      priority: 'LOW',
      description: null,
      url,
      project: { id: 'p', name: 'Lumo' },
      assignee: null,
    })
    expect(out.endsWith(`\nURL:\n  ${url}`)).toBe(true)
  })
})

describe('LUM-1090 — milestone show sections', () => {
  it('wraps a multi-line description and indents every line, not just the first', () => {
    const para = 'word '.repeat(40).trim()
    const out = formatMilestoneShow(
      { ...milestone, description: `${para}\nsecond paragraph` },
      []
    )
    const block = out.split('\nDescription\n')[1]!.split('\n\n')[0]!
    const lines = block.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    for (const l of lines) {
      expect(l.startsWith('  ')).toBe(true)
      expect(stringWidth(l)).toBeLessThanOrEqual(100)
    }
    expect(lines[lines.length - 1]).toBe('  second paragraph')
  })

  it('splits the long counts line into Progress rows, BACKLOG on its own row', () => {
    const out = formatMilestoneShow(milestone, [])
    expect(out).toContain(
      [
        '',
        'Progress',
        '  Done:       3 / 6',
        '  By status:  TODO 1 · IN_PROGRESS 2 · IN_REVIEW 0 · DONE 3',
        '  Backlog:    2 (not in the total)',
      ].join('\n')
    )
    expect(out).not.toMatch(/total \(TODO/)
  })

  it('no tasks: a Tasks (0) section that says so, no table', () => {
    const out = formatMilestoneShow(milestone, [])
    expect(
      out.endsWith('\nTasks (0)\n  None — no task is in this milestone.')
    ).toBe(true)
  })

  it('task table: header row on a TTY, none when piped', () => {
    const tty = formatMilestoneShow(milestone, [task], { tty: true })
    expect(tty).toContain(
      '\nTasks (1)\n  ID      STATUS       PRIORITY  PROJECT  TITLE\n  LUM-42  IN_PROGRESS'
    )
    const pipe = formatMilestoneShow(milestone, [task])
    expect(pipe).toContain(
      '\nTasks (1)\n  LUM-42\tIN_PROGRESS\tHIGH\tLumo\tFix'
    )
    expect(pipe).not.toContain('PRIORITY')
  })

  it('sprint coverage renders through the list table (header on a TTY)', () => {
    const coverage = {
      sprints: [
        {
          sprintId: 's',
          number: 3,
          name: 'Sprint 3',
          status: 'ACTIVE' as const,
          taskCount: 6,
          doneCount: 4,
        },
      ],
      unsprinted: 1,
    }
    const out = formatMilestoneShow(
      { ...milestone, sprintCoverage: coverage },
      [],
      { tty: true }
    )
    expect(out).toContain(
      [
        'Sprint coverage',
        '  SPRINT       STATUS  NAME      PROGRESS',
        '  #3           ACTIVE  Sprint 3  4/6 done',
        '  Unscheduled                    1 task',
      ].join('\n')
    )
  })

  it('cross-milestone learning is a headed block of aligned rows', () => {
    const out = formatMilestoneShow(
      {
        ...milestone,
        crossMilestoneLearning: {
          injected: 8,
          judged: 8,
          judgedUsed: 5,
          abstained: 0,
          sourceMilestones: 2,
          rate: 0.625,
        },
      },
      []
    )
    expect(out).toContain(
      [
        'Cross-milestone learning',
        '  Injected:    8 prior learnings (from 2 prior milestones)',
        '  Usage rate:  63% (judged-used 5/8)',
      ].join('\n')
    )
  })
})

describe('LUM-1090 — sprint show blockers', () => {
  const blockers = {
    overdueTaskIds: [
      { id: 'a', identifier: 'LUM-1', title: 'Fix login' },
      { id: 'b', identifier: 'LUM-8', title: 'Wire API' },
      { id: 'c', identifier: 'LUM-9', title: 'Ship docs' },
    ],
    stalledTaskIds: [],
    failingAgentTaskIds: [],
    staleOpenPrNumbers: [],
  }

  it('prints one blocker per line, aligned under the first', () => {
    const out = formatSprintShow(sprint, { done: 4, total: 10 }, [], blockers)
    expect(out).toContain(
      [
        'Blockers',
        '  Overdue:  LUM-1 Fix login',
        '            LUM-8 Wire API',
        '            LUM-9 Ship docs',
      ].join('\n')
    )
    expect(out).not.toContain('Fix login, ')
  })

  it('cuts an over-long blocker title so the line fits the report width', () => {
    const long = {
      ...blockers,
      overdueTaskIds: [
        { id: 'a', identifier: 'LUM-1', title: 'x'.repeat(200) },
      ],
    }
    const out = formatSprintShow(sprint, { done: 4, total: 10 }, [], long)
    const line = out.split('\n').find(l => l.startsWith('  Overdue:'))!
    expect(stringWidth(line)).toBe(100)
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('LUM-1090 — colour only when the caller turns it on', () => {
  it('pure calls are plain; colour bolds headings and dims labels', () => {
    const plain = formatMilestoneShow(milestone, [task])
    expect(plain).not.toContain(ESC)
    const coloured = formatMilestoneShow(milestone, [task], {
      color: true,
      tty: true,
    })
    expect(coloured).toContain(`${ESC}[1mProgress${ESC}[22m`)
    expect(coloured).toContain(`${ESC}[2mState:${ESC}[22m`)
    // LUM-1232 E-2: a bare enum value is coloured on a TTY.
    expect(coloured).toContain(`${ESC}[33mAT_RISK${ESC}[39m`)
  })

  it('sanitizes before styling: ESC in member text never reaches a styled line', () => {
    const out = formatTaskShow(
      {
        id: 't',
        identifier: 'LUM-1',
        title: `T${ESC}[31mred`,
        status: 'TODO',
        priority: 'LOW',
        description: null,
        url: 'u',
        project: { id: 'p', name: 'P' },
        assignee: null,
      },
      { color: true }
    )
    expect(out.split('\n')[0]).toBe(`${ESC}[1mLUM-1  T[31mred${ESC}[22m`)
  })
})

describe('LUM-1090 — session status', () => {
  const base = {
    exists: true,
    sessionId: 's',
    startedAt: '',
    lastActivityAt: '',
    eventCount: 2,
    taskIdentifier: 'LUM-12',
    taskTitle: 'Detail views',
  }

  it('binding rows padded to the widest label', () => {
    expect(formatSessionStatus('s', { ...base, parentSessionId: 'p' })).toBe(
      'Session s\nSubagent of:  p\nBound to:     LUM-12 "Detail views"\nEvents:       2\n'
    )
  })

  it('heading is bold only with colour on', () => {
    expect(formatSessionStatus('s', base, { color: true })).toContain(
      `${ESC}[1mSession s${ESC}[22m`
    )
  })
})

describe('LUM-1090 — task history table', () => {
  const entries: ActivityEntry[] = [
    {
      id: '1',
      kind: 'activity',
      type: 'CREATED',
      createdAt: '2026-10-10T01:02:00Z',
      actorId: 'a',
    },
    {
      id: '2',
      kind: 'activity',
      type: 'PRIORITY_CHANGED',
      createdAt: '2026-10-11T01:02:00Z',
      actorId: 'b',
      payload: { from: 'LOW', to: 'HIGH' },
    },
  ]
  const names = new Map([
    ['a', 'Al'],
    ['b', '李超'],
  ])

  it('TAB-separated when piped; pads the actor column by display width on a TTY (header there only)', () => {
    const pipe = formatHistory(entries, names, { tty: false }).split('\n')
    expect(pipe).toHaveLength(2)
    // LUM-1232 T-1: piped times are UTC ISO 8601 with `Z`.
    expect(pipe[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\tAl\tcreated$/)
    expect(pipe[1]).toMatch(/\t李超\tpriority LOW → HIGH$/)
    const tty = formatHistory(entries, names, {
      tty: true,
      color: false,
      width: 100,
    }).split('\n')
    // LUM-1232 T-2: a TTY shows local time with its UTC offset.
    expect(tty[0]).toBe(`${'WHEN'.padEnd(25)}ACTOR  CHANGE`)
    expect(tty[1]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d [+-]\d\d:\d\d  Al /)
    expect(tty).toHaveLength(3)
  })
})

describe('LUM-1090 — layout helpers', () => {
  it('fieldLines: `more` values align under the value column', () => {
    expect(
      fieldLines([{ label: 'Overdue', value: 'A', more: ['B', 'C'] }], 2)
    ).toEqual(['  Overdue:  A', '            B', '            C'])
  })

  it('fieldLines: `whole` never wraps a value that does not fit', () => {
    const v = 'y'.repeat(150)
    expect(fieldLines([{ label: 'URL', value: v, whole: true }], 0)).toEqual([
      'URL:',
      `  ${v}`,
    ])
  })

  it('indentLines: indents non-blank lines, empty block → no lines', () => {
    expect(indentLines('a\n\nb', 2)).toEqual(['  a', '', '  b'])
    expect(indentLines('', 2)).toEqual([])
  })

  it('taskTableSection: heading + indented table, or the empty sentence', () => {
    expect(taskTableSection([], 'None.')).toEqual(['', 'Tasks (0)', '  None.'])
    expect(taskTableSection([task], 'None.')).toEqual([
      '',
      'Tasks (1)',
      '  LUM-42\tIN_PROGRESS\tHIGH\tLumo\tFix Slack OAuth redirect',
    ])
  })
})
