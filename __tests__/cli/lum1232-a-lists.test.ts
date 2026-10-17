/**
 * @jest-environment node
 */
/**
 * LUM-1232 batch A — lists (docs/cli-output-conventions.md L-1–L-6, PG-1–PG-3,
 * decisions Q1 and Q5): TAB-separated pipes, upper-case TTY headers with only
 * the last free-text column cut, ref first, child rows that stand alone, one
 * paging footer and one empty-state sentence.
 */
import {
  childCell,
  renderListTable,
  tabRows,
} from '../../cli/src/lib/list-table'
import { pageFooter, NEXT_PAGE_PREFIX } from '../../cli/src/lib/pagination'
import { fmtLedger } from '../../cli/src/lib/format'
import { formatNextOutput } from '../../cli/src/commands/next'
import {
  formatListRow,
  formatTestCaseList,
  type ListRow,
} from '../../cli/src/commands/task-testcase-list'
import {
  formatOperationCost,
  type OperationCostResponse,
} from '../../cli/src/commands/cost'
import { formatDepsList } from '../../cli/src/commands/task-deps'
import { formatCrossingList } from '../../cli/src/commands/crossing-list'
import { formatMemoryList } from '../../cli/src/lib/memory-content'
import { formatTaskTemplateList } from '../../cli/src/commands/task-template-list'
import {
  formatAuditList,
  type AuditListPage,
} from '../../cli/src/commands/audit-list'
import type { RankedTask } from '../../cli/src/lib/rank-tasks'

describe('L-3 / Q1 — piped rows are TAB-separated', () => {
  it('no header, no padding, no truncation; a TAB inside a cell is flattened', () => {
    const out = renderListTable(
      [
        ['LUM-1', 'DONE', 'a title with  spaces'],
        ['LUM-10', 'TODO', 'tab\there'],
      ],
      { header: ['ID', 'STATUS', 'TITLE'], flex: 2, tty: false }
    )
    expect(out).toBe(
      'LUM-1\tDONE\ta title with  spaces\nLUM-10\tTODO\ttab here'
    )
    expect(tabRows([['a', 'b']])).toBe('a\tb')
  })

  it('TTY: upper-case header and only the flex (last) column is cut', () => {
    const out = renderListTable([['LUM-1', 'IN_PROGRESS', 'x'.repeat(80)]], {
      header: ['ID', 'STATUS', 'TITLE'],
      flex: 2,
      tty: true,
      color: false,
      width: 40,
    }).split('\n')
    expect(out[0]).toBe('ID     STATUS       TITLE')
    expect(out[1]!.startsWith('LUM-1  IN_PROGRESS  ')).toBe(true)
    expect(out[1]!.endsWith('…')).toBe(true)
    expect(out[1]!.length).toBeLessThanOrEqual(40)
  })
})

describe('L-6 / N-2 — child rows and ledger numbers', () => {
  it('a child row keys its parent when piped and indents on a TTY', () => {
    expect(childCell('Bash · read/search', 'grep', false)).toBe(
      'Bash · read/search/grep'
    )
    expect(childCell('Bash · read/search', 'grep', true)).toBe('  ↳ grep')
  })
  it('ledger numbers: separators on a TTY, plain integers piped', () => {
    expect(fmtLedger(4617665938, true)).toBe('4,617,665,938')
    expect(fmtLedger(4617665938, false)).toBe('4617665938')
  })
})

describe('PG-1 / Q5 — one paging footer', () => {
  it('Showing a-b of n, then Next page: <command> (not a Hint)', () => {
    expect(
      pageFooter(
        { total: 1094, offset: 0, nextCursor: '50', shown: 50 },
        'lumo task list'
      )
    ).toEqual([
      'Showing 1-50 of 1094.',
      'Next page: lumo task list --cursor 50',
    ])
    expect(NEXT_PAGE_PREFIX).toBe('Next page:')
  })

  it('audit list: Showing 1-N. then Next page: (total unknown)', () => {
    const page = {
      events: [
        {
          id: 'e1',
          createdAt: '2026-10-17T07:07:37.000Z',
          action: 'member.role_changed',
          actorType: 'MEMBER',
          actorId: 'u1',
          actorName: 'Al',
          actorEmail: null,
          source: 'WEB',
          targetType: 'member',
          targetId: 'm2',
          ip: null,
        },
      ],
      nextCursor: 'abc',
    } as AuditListPage
    const lines = formatAuditList(page, {}, { tty: false }).split('\n')
    expect(lines.slice(-2)).toEqual([
      'Showing 1-1.',
      'Next page: lumo audit list --cursor abc',
    ])
    expect(lines.join('\n')).not.toContain('Hint:')
  })
})

describe('L-4 — next: ref first, reasons in a WHY column', () => {
  const ranked = [
    {
      identifier: 'LUM-1039',
      task: { status: 'TODO', priority: 'URGENT', title: 'Fix routing' },
      reasons: ['URGENT'],
    },
    {
      identifier: 'LUM-1075',
      task: { status: 'TODO', priority: 'HIGH', title: 'Cut over' },
      reasons: ['HIGH', 'unblocks 2 tasks'],
    },
  ] as unknown as RankedTask[]

  it('piped: no rank prefix, no ↳ rows, WHY before TITLE', () => {
    const out = formatNextOutput(ranked, 66, 'open', {
      tty: false,
      hints: false,
    })
    expect(out.split('\n').slice(2)).toEqual([
      'LUM-1039\tTODO\tURGENT\t-\tFix routing',
      'LUM-1075\tTODO\tHIGH\tunblocks 2 tasks\tCut over',
    ])
  })

  it('TTY header', () => {
    const out = formatNextOutput(ranked, 66, 'open', {
      tty: true,
      color: false,
      width: 100,
      hints: false,
    })
    expect(out.split('\n')[2]).toMatch(/^ID\s+STATUS\s+PRIORITY\s+WHY\s+TITLE$/)
  })
})

describe('L-1 — testcase list goes through the shared renderer', () => {
  const c: ListRow = {
    number: 1,
    title: 'Footer disclosure',
    steps: ['s'],
    verification: [],
    runs: [
      {
        result: 'PASS',
        environment: 'LOCAL',
        createdAt: '2026-10-06T08:00:00.000Z',
        commitSha: null,
        commitDirty: null,
      },
    ],
  }
  it('piped rows are unchanged; a TTY gets the ID / TITLE / STEPS / LAST RUN header', () => {
    expect(formatTestCaseList([c], { tty: false })).toBe(formatListRow(c))
    const tty = formatTestCaseList([c], {
      tty: true,
      color: false,
      width: 120,
    }).split('\n')
    expect(tty[0]).toMatch(/^ID\s+TITLE\s+STEPS\s+LAST RUN$/)
    expect(tty[1]).toMatch(
      /^TC1\s+Footer disclosure\s+1 steps \/ 0 verify\s+PASS on LOCAL/
    )
  })
})

describe('L-2 — cost tables', () => {
  const row = (label: string, total: number) => ({
    key: label,
    label,
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheCreation: 4,
    total,
  })
  const data: OperationCostResponse = {
    version: 1,
    scope: { kind: 'task', label: 'LUM-1' },
    grandTotal: {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheCreation: 4,
      total: 1234567,
    },
    coverage: { perStepPct: 0.5, toolTurns: 2 },
    byTool: [
      {
        ...row('mcp__Claude_Browser__javascript_tool', 1234567),
        breakdown: [row('grep', 1000)],
      },
    ],
    byModel: [row('claude-opus-5-5', 1234567)],
    byMember: [],
    bySession: [],
  } as unknown as OperationCostResponse

  it('TTY: upper-case header, the operation name is never cut, numbers right-aligned', () => {
    const out = formatOperationCost(data, 'tool', null, {
      tty: true,
      color: false,
      width: 80,
    })
    expect(out).toContain('By tool\n  OPERATION')
    expect(out).toMatch(
      /OPERATION\s+OUTPUT\s+INPUT\s+CACHE WRITE\s+CACHE READ\s+TOTAL/
    )
    expect(out).toContain('mcp__Claude_Browser__javascript_tool')
    expect(out).toContain('  ↳ grep')
    expect(out).toContain('1,234,567')
    expect(out).not.toMatch(/^\s*operation\s/m)
  })

  it('piped: TAB rows, plain integers, child rows keyed parent/child', () => {
    const out = formatOperationCost(data, 'tool', null, { tty: false })
    expect(out).toContain(
      'By tool\nmcp__Claude_Browser__javascript_tool\t2\t1\t4\t3\t1234567'
    )
    expect(out).toContain(
      'mcp__Claude_Browser__javascript_tool/grep\t2\t1\t4\t3\t1000'
    )
    expect(out).not.toContain('OPERATION')
  })
})

describe('PG-2 / PG-3 — empty states and hidden rows', () => {
  it('deps: one emptyState sentence', () => {
    expect(formatDepsList('LUM-1185', [])).toBe('No dependencies on LUM-1185.')
  })

  it('crossing list: empty state names the task; the hidden notice comes after it', () => {
    const out = formatCrossingList('LUM-1185', [
      { disposition: 'CONFIRMED', blocking: false } as never,
      { disposition: 'FALSE_POSITIVE', blocking: false } as never,
    ])
    expect(out.trimEnd().split('\n').slice(-2)).toEqual([
      'No open crossings on LUM-1185.',
      '2 dispositioned crossings hidden. Show them with --all.',
    ])
    expect(out).not.toContain('crossing(s)')
  })
})

describe('L-1 — memory and template lists use the shared renderer', () => {
  it('memory list: ID SCOPE CATEGORY SOURCE HEADLINE, TAB-separated when piped', () => {
    const out = formatMemoryList(
      [
        {
          id: 'cmabcdef3lao7kmv',
          scope: 'TASK',
          category: 'DECISION',
          content: { summary: 'Use published CLI' },
          createdByMemberId: null,
        } as never,
      ],
      { tty: false }
    )
    expect(out.split('\t')).toHaveLength(5)
    expect(out).toMatch(/^3lao7kmv\tTASK\tDECISION\tauto\t/)
  })

  it('template list: KEY NAME KIND DESCRIPTION', () => {
    const out = formatTaskTemplateList(
      [
        {
          key: 'agent-brief',
          name: 'Agent brief',
          isSystem: true,
          description: null,
        } as never,
      ],
      { tty: false }
    )
    expect(out.split('\n')[1]).toBe('agent-brief\tAgent brief\tbuilt-in\t-')
  })
})
