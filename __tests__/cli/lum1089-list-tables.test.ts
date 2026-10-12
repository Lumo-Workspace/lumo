/**
 * @jest-environment node
 *
 * LUM-1089 — every list command renders through one table helper
 * (`renderListTable` on top of LUM-1086's `renderTable`):
 * - header row on a TTY only; non-TTY output stays headerless, untruncated
 *   and colourless (agents parse it — first column is the id);
 * - on a TTY the free-text column is cut to the terminal width;
 * - columns align by display width (CJK counts 2);
 * - milestone state / health labels are upper-case in list and show.
 */
import {
  MIN_FLEX_WIDTH,
  flexColumnCap,
  renderListTable,
} from '@/cli/src/lib/list-table'
import { stringWidth } from '@/cli/src/lib/ui'
import { formatTaskListTable, type TaskRow } from '@/cli/src/lib/format'
import { formatSearchTable } from '@/cli/src/commands/task-search'
import { formatNextOutput } from '@/cli/src/commands/next'
import {
  formatDocListRows,
  formatDocListRowsAsTree,
} from '@/cli/src/commands/doc-list'
import { formatArtifactList } from '@/cli/src/commands/task-artifact-list'
import { formatFigmaList } from '@/cli/src/commands/task-figma-list'
import { formatMilestoneList } from '@/cli/src/commands/milestone-list'
import {
  formatMilestoneShow,
  type MilestoneShowData,
} from '@/cli/src/commands/milestone-show'
import { formatSprintList } from '@/cli/src/commands/sprint-list'
import { formatTagList } from '@/cli/src/commands/tag'
import { formatMemberList } from '@/cli/src/commands/member-list'
import { formatAuditList } from '@/cli/src/commands/audit-list'
import {
  HEALTH_LABEL,
  formatHealth,
  milestoneState,
} from '@/cli/src/lib/milestone-labels'
import type { RankedTask } from '@/cli/src/lib/rank-tasks'
import type { Directory } from '@/cli/src/lib/directory'

const LONG_TITLE =
  'A very long task title that keeps going well past any narrow terminal width limit'
const ESC = String.fromCharCode(27)
const TTY = { tty: true, width: 60, color: false } as const
const PIPE = { tty: false, color: false } as const

/** Display column at which `needle` starts in `line`. */
function colOf(line: string, needle: string): number {
  const i = line.indexOf(needle)
  if (i < 0) throw new Error(`"${needle}" not in "${line}"`)
  return stringWidth(line.slice(0, i))
}

function task(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    number: 42,
    title: 'Fix Slack OAuth redirect',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    teamIdentifier: 'LUM',
    project: { id: 'p1', name: 'web' },
    ...over,
  }
}

describe('renderListTable', () => {
  const rows = [
    ['LUM-1', 'TODO', LONG_TITLE],
    ['LUM-22', 'DONE', 'short'],
  ]

  it('non-TTY: no header, nothing truncated, no ESC', () => {
    const out = renderListTable(rows, {
      header: ['ID', 'STATUS', 'TITLE'],
      flex: 2,
      width: 30,
      tty: false,
      color: true,
    })
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(`LUM-1   TODO  ${LONG_TITLE}`)
    expect(out).not.toContain('…')
    expect(out).not.toContain(ESC)
  })

  it('TTY: header first and the flex column cut so rows fit the width', () => {
    const out = renderListTable(rows, {
      header: ['ID', 'STATUS', 'TITLE'],
      flex: 2,
      ...TTY,
    })
    const lines = out.split('\n')
    expect(lines[0]).toBe('ID      STATUS  TITLE')
    expect(lines[1]).toContain('…')
    for (const l of lines) expect(stringWidth(l)).toBeLessThanOrEqual(60)
    expect(lines[2]).toBe('LUM-22  DONE    short')
  })

  it('TTY: the flex column never shrinks below MIN_FLEX_WIDTH', () => {
    expect(flexColumnCap([['x'.repeat(80), 'y']], 1, 40)).toBe(MIN_FLEX_WIDTH)
    expect(flexColumnCap([['abc', 'y']], 1, 40)).toBe(40 - 3 - 2)
  })

  it('an all-empty trailing column costs no gap in the flex cap', () => {
    expect(flexColumnCap([['abc', 'y', '']], 1, 40)).toBe(40 - 3 - 2)
  })

  it('TTY: a figma list with no stale link uses the full width for the frame', () => {
    const link = {
      id: 'cfl_1',
      fileName: 'File',
      frameName: 'F'.repeat(80),
      lastSyncedAt: '2026-06-28T00:00:00Z',
      thumbnailUrl: null,
      thumbnailFetchedAt: null,
    }
    const [, row = ''] = formatFigmaList([link], 0, TTY).split('\n')
    expect(stringWidth(row)).toBe(60)
  })
})

describe('task tables (task list / search / next)', () => {
  it('non-TTY task list matches the documented headerless shape byte-for-byte', () => {
    const out = formatTaskListTable(
      [
        task(),
        task({
          number: 48,
          status: 'TODO',
          priority: 'MEDIUM',
          project: { id: 'p2', name: 'backend' },
          title: 'Investigate slow query',
        }),
      ],
      PIPE
    )
    expect(out).toBe(
      [
        'LUM-42  IN_PROGRESS  HIGH    web      Fix Slack OAuth redirect',
        'LUM-48  TODO         MEDIUM  backend  Investigate slow query',
      ].join('\n')
    )
  })

  it('aligns CJK project names and titles by display width', () => {
    const out = formatTaskListTable(
      [
        task({ project: { id: 'p1', name: '前端' }, title: '修复登录' }),
        task({ number: 7, project: { id: 'p2', name: 'web-app' } }),
      ],
      PIPE
    )
    const [a = '', b = ''] = out.split('\n')
    expect(colOf(a, '修复登录')).toBe(colOf(b, 'Fix Slack'))
  })

  it('TTY task list: header + title cut to the terminal width', () => {
    const out = formatTaskListTable([task({ title: LONG_TITLE })], TTY)
    const [header = '', row = ''] = out.split('\n')
    expect(header.split(/\s+/)).toEqual([
      'ID',
      'STATUS',
      'PRIORITY',
      'PROJECT',
      'TITLE',
    ])
    expect(row.startsWith('LUM-42')).toBe(true)
    expect(row.endsWith('…')).toBe(true)
    expect(stringWidth(row)).toBeLessThanOrEqual(60)
  })

  it('non-TTY task list never truncates', () => {
    const out = formatTaskListTable([task({ title: LONG_TITLE })], PIPE)
    expect(out).toContain(LONG_TITLE)
    expect(out.split('\n')).toHaveLength(1)
  })

  it('task search shares the table: extra columns, CJK aligned, TTY header', () => {
    const rows = [
      {
        number: 1,
        title: '中文标题',
        status: 'TODO',
        priority: 'LOW',
        teamIdentifier: 'LUM',
        dueDate: null,
        assigneeActorId: 'a1',
        project: { id: 'p', name: '项目' },
      },
      {
        number: 22,
        title: 'English',
        status: 'DONE',
        priority: 'HIGH',
        teamIdentifier: 'LUM',
        dueDate: null,
        assigneeActorId: null,
        project: null,
      },
    ]
    const names = new Map([['a1', '张三']])
    const pipe = formatSearchTable(rows, names, PIPE).split('\n')
    expect(pipe).toHaveLength(2)
    expect(pipe[0]?.startsWith('LUM-1 ')).toBe(true)
    expect(colOf(pipe[0] ?? '', '中文标题')).toBe(
      colOf(pipe[1] ?? '', 'English')
    )
    const tty = formatSearchTable(rows, names, TTY).split('\n')
    expect(tty[0]?.split(/\s+/)).toEqual([
      'ID',
      'STATUS',
      'PRIORITY',
      'PROJECT',
      'ASSIGNEE',
      'DUE',
      'TITLE',
    ])
  })

  function ranked(identifier: string, title: string): RankedTask {
    return {
      identifier,
      task: {
        id: identifier,
        number: 1,
        title,
        status: 'TODO',
        priority: 'MEDIUM',
        teamIdentifier: 'LUM',
        sprintId: null,
        dueDate: null,
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      reasons: ['MEDIUM'],
    }
  }

  it('next keeps `1. LUM-N` rows + reasons off a TTY, adds a header on one', () => {
    const list = [ranked('LUM-42', LONG_TITLE), ranked('LUM-7', '短')]
    const pipe = formatNextOutput(list, 5, 'open', PIPE).split('\n')
    expect(pipe[2]).toBe(`1. LUM-42  TODO  MEDIUM  ${LONG_TITLE}`)
    expect(pipe[3]).toBe('     ↳ MEDIUM')
    expect(pipe[4]).toBe('2. LUM-7   TODO  MEDIUM  短')
    const tty = formatNextOutput(list, 5, 'open', TTY).split('\n')
    expect(tty[2]?.split(/\s+/)).toEqual([
      'TASK',
      'STATUS',
      'PRIORITY',
      'TITLE',
    ])
    expect(tty[3]?.startsWith('1. LUM-42')).toBe(true)
    expect(tty[3]?.endsWith('…')).toBe(true)
    expect(tty[4]).toBe('     ↳ MEDIUM')
  })
})

describe('doc / artifact / figma lists', () => {
  const docs = [
    {
      id: 'doc_a',
      title: '设计文档',
      visibility: 'WORKSPACE' as const,
      project: { name: '前端' },
      parentId: null,
      sortOrder: 0,
    },
    {
      id: 'doc_bb',
      title: 'Child',
      visibility: 'PRIVATE' as const,
      project: null,
      parentId: 'doc_a',
      sortOrder: 0,
    },
  ]

  it('doc list: id first, no header off a TTY, CJK aligned, header on a TTY', () => {
    const pipe = formatDocListRows(docs, PIPE)
    expect(pipe).toHaveLength(2)
    expect(pipe[0]?.startsWith('doc_a ')).toBe(true)
    expect(colOf(pipe[0] ?? '', '设计文档')).toBe(colOf(pipe[1] ?? '', 'Child'))
    expect(pipe[1]).toContain('PERSONAL')
    const tty = formatDocListRows(docs, TTY)
    expect(tty[0]?.split(/\s+/)).toEqual(['ID', 'SCOPE', 'PROJECT', 'TITLE'])
  })

  it('doc list --tree indents inside the title column', () => {
    const tree = formatDocListRowsAsTree(docs, PIPE)
    expect(tree[1]).toMatch(/\s{2}Child$/)
    expect(colOf(tree[1] ?? '', 'Child')).toBe(
      colOf(tree[0] ?? '', '设计文档') + 2
    )
  })

  it('artifact list: id first, title cut only on a TTY', () => {
    const rows = [
      {
        id: 'art_1',
        kind: 'plan',
        title: LONG_TITLE,
        source: 'cli',
        agent: 'CLAUDE_CODE',
        order: 0,
      },
    ]
    expect(formatArtifactList(rows, PIPE)).toContain(LONG_TITLE)
    const tty = formatArtifactList(rows, TTY).split('\n')
    expect(tty[0]?.split(/\s+/)).toEqual([
      'ID',
      'KIND',
      'AGENT',
      'SOURCE',
      'TITLE',
    ])
    expect(tty[1]?.endsWith('…')).toBe(true)
  })

  it('figma list: no fixed widths (long names do not skew), NOTE header only when stale', () => {
    const now = Date.parse('2026-06-30T00:00:00Z')
    const base = {
      id: 'cfl_1',
      fileName: 'A really long Figma file name that overflows',
      frameName: 'Welcome',
      lastSyncedAt: '2026-06-28T00:00:00Z',
      thumbnailUrl: 'https://t/x.png',
      thumbnailFetchedAt: '2026-06-29T00:00:00Z',
    }
    const fresh = formatFigmaList(
      [base, { ...base, id: 'cfl_22', fileName: 'Short', frameName: null }],
      now,
      PIPE
    ).split('\n')
    expect(colOf(fresh[0] ?? '', 'Welcome')).toBe(
      colOf(fresh[1] ?? '', '(file-level)')
    )
    expect(formatFigmaList([base], now, TTY).split('\n')[0]).toBe(
      'ID     FILE                                          FRAME    SYNCED'
    )
    const stale = { ...base, thumbnailFetchedAt: '2026-05-01T00:00:00Z' }
    const out = formatFigmaList([stale], now, TTY).split('\n')
    expect(out[0]?.endsWith('NOTE')).toBe(true)
    expect(out[1]?.endsWith('⚠ thumbnail stale')).toBe(true)
  })
})

describe('milestone / sprint / tag / member / audit lists', () => {
  const ms = {
    id: 'm1',
    name: '第三季度 Launch',
    completedAt: null,
    targetDate: '2026-09-30T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
    archivedAt: null,
    health: 'at-risk' as const,
  }

  it('milestone list: upper-case STATE/HEALTH, header on a TTY only', () => {
    const pipe = formatMilestoneList([ms], PIPE)
    expect(pipe).toBe('ACTIVE  AT-RISK  2026-09-30  第三季度 Launch')
    const tty = formatMilestoneList([ms], TTY).split('\n')
    expect(tty[0]?.split(/\s+/)).toEqual(['STATE', 'HEALTH', 'TARGET', 'NAME'])
  })

  it('milestone show uses the same upper-case state + health words', () => {
    const data: MilestoneShowData = {
      id: 'm1',
      name: 'Q3',
      completedAt: null,
      startDate: null,
      targetDate: null,
      archivedAt: null,
      description: null,
      projectName: 'web',
      taskCounts: { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 },
      health: 'on-track',
    }
    const out = formatMilestoneShow(data, [])
    expect(out).toContain('State:      ACTIVE\n')
    expect(out).toContain('Health:     ON-TRACK\n')
    expect(milestoneState({ completedAt: 'x', archivedAt: null })).toBe(
      'COMPLETED'
    )
    expect(milestoneState({ completedAt: 'x', archivedAt: 'y' })).toBe(
      'ARCHIVED'
    )
    expect(formatHealth(null)).toBe('-')
    expect(Object.values(HEALTH_LABEL)).toEqual([
      'ON-TRACK',
      'AT-RISK',
      'OVERDUE',
    ])
  })

  it('sprint list: same columns off a TTY, header on one', () => {
    const rows = [
      {
        id: 's',
        number: 3,
        name: 'Sprint 3',
        status: 'ACTIVE' as const,
        startDate: '2026-06-01T00:00:00Z',
        endDate: '2026-06-14T00:00:00Z',
      },
      {
        id: 's2',
        number: 12,
        name: '冲刺',
        status: 'DRAFT' as const,
        startDate: null,
        endDate: null,
      },
    ]
    expect(formatSprintList(rows, PIPE)).toBe(
      [
        'ACTIVE  #3   2026-06-01..2026-06-14  Sprint 3',
        'DRAFT   #12  -..-                    冲刺',
      ].join('\n')
    )
    expect(formatSprintList(rows, TTY).split('\n')[0]?.split(/\s+/)).toEqual([
      'STATUS',
      'SPRINT',
      'DATES',
      'NAME',
    ])
  })

  it('tag list: CJK names aligned; header on a TTY only', () => {
    const tags = [
      {
        id: '1',
        name: '缺陷',
        color: '#ff0000',
        taskCount: 1,
        documentCount: 0,
      },
      { id: '2', name: 'infra', color: null, taskCount: 2, documentCount: 3 },
    ]
    const pipe = formatTagList(tags, PIPE).split('\n')
    expect(pipe).toHaveLength(2)
    expect(colOf(pipe[0] ?? '', '#ff0000')).toBe(colOf(pipe[1] ?? '', '-'))
    expect(formatTagList(tags, TTY).split('\n')[0]?.split(/\s+/)).toEqual([
      'NAME',
      'COLOR',
      'TASKS',
      'DOCS',
    ])
  })

  it('member list: CJK names aligned, agents section kept, header on a TTY', () => {
    const dir: Directory = {
      members: [
        {
          memberId: 'm1',
          displayName: '李超',
          email: 'li@example.com',
          actorId: 'a1',
          role: 'OWNER',
          clerkId: 'u1',
        },
        {
          memberId: 'm2',
          displayName: 'Bob',
          email: null,
          actorId: 'a2',
          role: 'MEMBER',
          clerkId: 'u2',
        },
      ],
      agents: [{ actorId: 'x', name: 'Claude Code', type: 'CODING' }],
    }
    const pipe = formatMemberList(dir, PIPE).split('\n')
    expect(colOf(pipe[0] ?? '', 'li@')).toBe(colOf(pipe[1] ?? '', '-'))
    expect(pipe.slice(2)).toEqual(['', 'Agents:', '  Claude Code  (CODING)'])
    expect(formatMemberList(dir, TTY).split('\n')[0]?.split(/\s+/)).toEqual([
      'NAME',
      'EMAIL',
      'ROLE',
    ])
  })

  it('audit list: rows unchanged off a TTY, header on one', () => {
    const page = {
      events: [
        {
          id: 'e1',
          createdAt: '2026-10-04T15:54:00.000Z',
          action: 'member.role_changed',
          actorType: 'MEMBER' as const,
          actorId: 'm1',
          actorName: '李超',
          actorEmail: 'li@example.com',
          source: 'WEB',
          targetType: 'member',
          targetId: 'cm1abc',
          ip: '203.0.113.9',
        },
      ],
      nextCursor: null,
    }
    expect(formatAuditList(page, {}, PIPE)).toBe(
      '2026-10-04 15:54Z  member.role_changed  李超 <li@example.com>  member cm1abc  WEB  203.0.113.9'
    )
    expect(formatAuditList(page, {}, TTY).split('\n')[0]).toMatch(
      /^TIME \(UTC\)\s+ACTION\s+ACTOR\s+TARGET\s+SOURCE\s+IP$/
    )
  })
})
