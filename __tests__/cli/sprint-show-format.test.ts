/**
 * @jest-environment node
 */
import { formatSprintShow } from '@/cli/src/commands/sprint-show'
import type { TaskRow } from '@/cli/src/lib/format'

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

const progress = { done: 4, total: 10 }

const task: TaskRow = {
  id: 'task-1',
  number: 42,
  title: 'Fix Slack OAuth redirect',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  teamIdentifier: 'LUM',
  project: { id: 'p-1', name: 'Lumo' },
}

describe('formatSprintShow', () => {
  it('renders sprint header, progress, and task table', () => {
    const out = formatSprintShow(sprint, progress, [task])
    expect(out).toContain('Sprint:    #3 Sprint 3')
    expect(out).toContain('Status:    ACTIVE')
    expect(out).toContain('Team:      Engineering')
    expect(out).toContain('Start:     2026-06-01')
    expect(out).toContain('End:       2026-06-14')
    expect(out).toContain('Started:   2026-06-01')
    expect(out).toContain('Closed:    -')
    expect(out).toContain('Progress:  4 / 10')
    expect(out).toContain('LUM-42  IN_PROGRESS')
  })

  it('renders "-" for null dates and omits task table when no tasks', () => {
    const out = formatSprintShow(
      {
        ...sprint,
        startedAt: null,
        closedAt: null,
      },
      { done: 0, total: 0 },
      []
    )
    expect(out).toContain('Started:   -')
    expect(out).toContain('Closed:    -')
    expect(out).toContain('Progress:  0 / 0')
    expect(out).not.toContain('LUM-')
  })

  it('omits the Health line entirely when risk is not provided', () => {
    const out = formatSprintShow(sprint, progress, [task])
    expect(out).not.toContain('Health:')
    expect(out).not.toContain('Blockers:')
  })

  it('renders the health level, reasons, and blockers when provided', () => {
    const risk = {
      level: 'at-risk',
      score: 5,
      reasons: [
        { code: 'overdue_ratio_high', detail: '4/10 tasks overdue (40%)' },
        {
          code: 'stalled_tasks',
          detail: '3 tasks with no progress in 7 days',
        },
      ],
    }
    const topBlockers = {
      overdueTaskIds: [
        { id: 't1', identifier: 'LUM-1', title: 'Fix login' },
        { id: 't8', identifier: 'LUM-8', title: 'Wire API' },
      ],
      stalledTaskIds: [{ id: 't5', identifier: 'LUM-5', title: 'Add tests' }],
      failingAgentTaskIds: [
        { id: 't9', identifier: 'LUM-9', title: 'Agent task' },
      ],
      staleOpenPrNumbers: [12, 15],
    }
    const out = formatSprintShow(sprint, progress, [task], risk, topBlockers)
    expect(out).toContain('Health:    AT-RISK')
    expect(out).toContain('- 4/10 tasks overdue (40%)')
    expect(out).toContain('- 3 tasks with no progress in 7 days')
    expect(out).toContain('Blockers:')
    expect(out).toContain('LUM-1 Fix login')
    expect(out).toContain('LUM-8 Wire API')
    expect(out).toContain('LUM-5 Add tests')
    expect(out).toContain('LUM-9 Agent task')
    expect(out).toContain('#12, #15')
  })

  it('renders the Health line but no Blockers section when all blockers empty', () => {
    const risk = { level: 'healthy', score: 0, reasons: [] }
    const topBlockers = {
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
    }
    const out = formatSprintShow(sprint, progress, [], risk, topBlockers)
    expect(out).toContain('Health:    HEALTHY')
    expect(out).not.toContain('Blockers:')
  })
})
