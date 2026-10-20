/**
 * @jest-environment node
 *
 * LUM-1282: the CANCELED status on the smaller surfaces — next-step hints,
 * the DONE-readiness section, `task statuses`, `task deps`, quick dispatch,
 * the board columns, completed-task filter and dependency grouping.
 */
import { computeNextSteps } from '@/lib/context/render/next-steps'
import {
  assessReadiness,
  formatDoneReadiness,
  type ReadinessInput,
} from '@/cli/src/lib/done-readiness'
import { formatTaskStatuses } from '@/cli/src/commands/task-statuses'
import { formatDepsList } from '@/cli/src/commands/task-deps'
import { buildCloseDecisions } from '@/cli/src/commands/sprint-close'
import { isClosedStatus } from '@/cli/src/lib/task-closed'
import { parseQuickDispatch } from '@/lib/quick-dispatch/rule-parser'
import {
  boardStatuses,
  statusLabel,
} from '@/app/workspace/[workspaceUrl]/utils/taskStatus'
import { filterCompletedTasks } from '@/app/workspace/[workspaceUrl]/utils/filterCompletedTasks'
import {
  computeLiveBlockers,
  groupDependencies,
} from '@/app/workspace/[workspaceUrl]/dependencies/groupDependencies'
import type { DependencyEdge } from '@/app/workspace/[workspaceUrl]/dependencies/types'
import { taskWorkflowCatalog } from '@/lib/task/state-machine'

jest.mock('@/lib/db/prisma', () => ({ prisma: { task: {} } }))
jest.mock('@/lib/events/dispatcher', () => ({ dispatchEvents: jest.fn() }))

describe('next steps', () => {
  it('a CANCELED task gets one stop line and no command', () => {
    const steps = computeNextSteps({
      taskIdentifier: 'LUM-1',
      status: 'CANCELED',
      sessionBound: false,
      openCrossings: 2,
    })
    expect(steps).toHaveLength(1)
    expect(steps[0]!.command).toBeNull()
    expect(steps[0]!.why).toMatch(/CANCELED/)
  })
})

describe('DONE readiness for a CANCELED task', () => {
  it('reports CANCELED and offers no DONE command', () => {
    const input: ReadinessInput = {
      identifier: 'LUM-1',
      status: { ok: false, reason: 'not read' },
      task: {
        ok: true,
        value: { identifier: 'LUM-1', title: 'T', status: 'CANCELED' },
      },
      crossings: { status: 'ok', crossings: [], gateEnabled: true },
      worktrees: null,
    }
    const r = assessReadiness(input)
    expect(r.level).toBe('CANCELED')
    const out = formatDoneReadiness(input, r).join('\n')
    expect(out).toContain('CANCELED — closed by the user, not delivered')
    expect(out).not.toContain('--status done')
  })
})

describe('task statuses', () => {
  it('shows CANCELED as gated', () => {
    const out = formatTaskStatuses({
      ...taskWorkflowCatalog(),
      priorities: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    })
    expect(out).toMatch(
      /^Gated: DONE, CANCELED — entering one needs the user's --confirm \(exit-4 envelope\)/m
    )
    expect(out).toMatch(
      /^ {2}CANCELED\s+→ BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE$/m
    )
  })
})

describe('task deps', () => {
  it('renders a DUPLICATES edge as duplicate of / duplicated by', () => {
    const edge = (direction: 'BLOCKED_BY' | 'BLOCKS', id: string) => ({
      id,
      direction,
      kind: 'DUPLICATES',
      source: 'MANUAL',
      status: 'CONFIRMED',
      reason: null,
      detail: null,
      other: { identifier: 'LUM-12', title: 'Canon', status: 'TODO' },
    })
    const out = formatDepsList('LUM-48', [
      edge('BLOCKED_BY', 'aaaaaaaa1'),
      edge('BLOCKS', 'bbbbbbbb2'),
    ] as never)
    expect(out).toContain('duplicate of LUM-12')
    expect(out).toContain('duplicated by LUM-12')
  })
})

describe('sprint close', () => {
  it('closed tasks (DONE, CANCELED) need no spillover decision', () => {
    expect(isClosedStatus('CANCELED')).toBe(true)
    const decisions = buildCloseDecisions(
      [
        { id: 'a', status: 'CANCELED' },
        { id: 'b', status: 'DONE' },
        { id: 'c', status: 'TODO' },
      ] as never,
      'backlog'
    )
    expect(decisions).toEqual({ c: 'backToBacklog' })
  })
})

describe('quick dispatch keywords', () => {
  const mention = {
    type: 'task' as const,
    id: 't1',
    identifier: 'LUM-7',
    title: 'x',
  }
  it('"cancel" / "取消" on a task mention is a CANCELED update', () => {
    for (const text of ['cancel LUM-7', '取消 LUM-7']) {
      const r = parseQuickDispatch(text, [mention] as never)
      expect(r.actions[0]).toMatchObject({
        type: 'update',
        fields: { status: 'CANCELED' },
      })
    }
  })
  it('a create never comes out CANCELED', () => {
    const r = parseQuickDispatch('create cancel button styling', [])
    expect(r.actions[0]).toMatchObject({ type: 'create', status: 'TODO' })
  })
})

describe('web helpers', () => {
  it('board shows a CANCELED column only when a task is in it', () => {
    expect(boardStatuses([{ status: 'TODO' }])).not.toContain('CANCELED')
    expect(boardStatuses([{ status: 'CANCELED' }])).toEqual([
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
      'CANCELED',
    ])
  })

  it('status label resolves through react-intl', () => {
    expect(
      statusLabel({ formatMessage: ({ id }) => `#${id}` }, 'CANCELED')
    ).toBe('#status.canceled')
  })

  it('the "hide completed" filter also hides CANCELED', () => {
    const tasks = [
      { status: 'CANCELED', updatedAt: '2020-01-01T00:00:00.000Z' },
      { status: 'TODO', updatedAt: '2020-01-01T00:00:00.000Z' },
    ]
    expect(filterCompletedTasks(tasks, 'none').map(t => t.status)).toEqual([
      'TODO',
    ])
  })

  it('DUPLICATES edges get their own groups; a CANCELED blocker is not live', () => {
    const base = {
      source: 'MANUAL' as const,
      status: 'CONFIRMED' as const,
      reason: null,
      detail: null,
    }
    const edges: DependencyEdge[] = [
      {
        ...base,
        id: '1',
        direction: 'BLOCKED_BY',
        kind: 'DUPLICATES',
        other: { identifier: 'LUM-12', title: 'c', status: 'TODO' },
      },
      {
        ...base,
        id: '2',
        direction: 'BLOCKS',
        kind: 'DUPLICATES',
        other: { identifier: 'LUM-50', title: 'd', status: 'CANCELED' },
      },
      {
        ...base,
        id: '3',
        direction: 'BLOCKED_BY',
        kind: 'BLOCKS',
        other: { identifier: 'LUM-9', title: 'b', status: 'CANCELED' },
      },
    ]
    const g = groupDependencies(edges)
    expect(g.duplicateOf.map(e => e.id)).toEqual(['1'])
    expect(g.duplicatedBy.map(e => e.id)).toEqual(['2'])
    expect(g.blockedBy.map(e => e.id)).toEqual(['3'])
    expect(computeLiveBlockers(edges)).toEqual([])
  })
})
