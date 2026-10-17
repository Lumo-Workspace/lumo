/**
 * @jest-environment node
 */
import { formatMilestoneShow } from '@/cli/src/commands/milestone-show'
import type { TaskRow } from '@/cli/src/lib/format'

const milestone = {
  id: 'm-1',
  name: 'Q3 Launch',
  completedAt: null,
  startDate: '2026-06-01T00:00:00.000Z',
  targetDate: '2026-08-31T00:00:00.000Z',
  archivedAt: null,
  description: 'Ship the launch.',
  projectName: 'Lumo',
  taskCounts: { TODO: 1, IN_PROGRESS: 2, IN_REVIEW: 0, DONE: 3 },
}

const task: TaskRow = {
  id: 't-1',
  number: 42,
  title: 'Fix Slack OAuth redirect',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  teamIdentifier: 'LUM',
  project: { id: 'p-1', name: 'Lumo' },
}

describe('formatMilestoneShow', () => {
  it('renders milestone header + counts + task table', () => {
    const out = formatMilestoneShow(milestone, [task])
    expect(out).toContain('Milestone:  Q3 Launch')
    expect(out).toContain('State:      ACTIVE')
    expect(out).toContain('Completed:  -')
    expect(out).toContain('Archived:   -')
    expect(out).toContain('Start:      2026-06-01')
    expect(out).toContain('Target:     2026-08-31')
    expect(out).toContain('Project:    Lumo')
    expect(out).toContain('\nDescription\n  Ship the launch.\n')
    expect(out).toContain('\nProgress\n  Done:       3 / 6\n')
    expect(out).toContain(
      '  By status:  TODO 1 · IN_PROGRESS 2 · IN_REVIEW 0 · DONE 3'
    )
    expect(out).toContain('\nTasks (1)\n  LUM-42\tIN_PROGRESS')
  })

  it('LUM-1230: shows the slug (the ref to type), never the id', () => {
    const out = formatMilestoneShow(
      {
        ...milestone,
        id: 'cmv95ivuj000l06jvjrs7b7z1',
        slug: 'headless-web-cli',
      },
      []
    )
    expect(out).toMatch(/Slug:\s+headless-web-cli/)
    expect(out).not.toContain('cmv95ivuj000l06jvjrs7b7z1')
  })

  it('renders the health light when provided, "-" when absent', () => {
    expect(
      formatMilestoneShow({ ...milestone, health: 'at-risk' }, [])
    ).toContain('Health:     AT_RISK')
    expect(formatMilestoneShow({ ...milestone, health: null }, [])).toContain(
      'Health:     -'
    )
    // No health field at all → also "-"
    expect(formatMilestoneShow(milestone, [])).toContain('Health:     -')
  })

  it('renders "-" for missing description and dates', () => {
    const out = formatMilestoneShow(
      { ...milestone, description: null, startDate: null, targetDate: null },
      []
    )
    expect(out).toContain('Start:      -')
    expect(out).toContain('Target:     -')
    expect(out).toMatch(/\nDescription\n  -\n/)
  })

  it('omits the task table when there are zero tasks', () => {
    const out = formatMilestoneShow(
      {
        ...milestone,
        taskCounts: { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 },
      },
      []
    )
    expect(out).toContain('Done:       0 / 0')
    expect(out).toContain('\nTasks (0)\n  None — no task is in this milestone.')
    expect(out).not.toContain('LUM-')
  })
})
