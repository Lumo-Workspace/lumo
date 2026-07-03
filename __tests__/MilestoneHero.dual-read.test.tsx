/** @jest-environment jsdom */
// LUM-650 — the milestone Overview progress ring's dual-read: the task-count
// reading is preserved, and a complexity-weighted reading toggles onto the
// same ring. The weighted view surfaces its measurement coverage and reads an
// explicit "no data yet" (never a fabricated 0%) when no task is measured.

const messages: Record<string, string> = {
  'milestone.rollup.label': 'Milestone summary',
  'milestone.rollup.noTasks': 'No tasks yet',
  'milestone.progress': '{done}/{total} tasks',
  'milestone.hero.eyebrow': 'Milestone',
  'milestone.hero.eyebrowWithSprints': 'Milestone · {sprints}',
  'milestone.hero.progressModeLabel': 'Progress reading',
  'milestone.hero.progressMode.tasks': 'By task count',
  'milestone.hero.progressMode.complexity': 'By complexity',
  'milestone.hero.weightedCoverage': 'weighted · {measured}/{total} measured',
  'milestone.hero.weightedUnavailable': 'No complexity data yet',
  'milestone.hero.healthUnavailable': 'Unavailable',
  'milestone.hero.notSet': 'Not set',
  'milestone.hero.setDate': 'Set date',
  'milestone.hero.scheduleHint': 'Set a target date.',
  'milestone.hero.startDerivedHint': 'Derived from activity',
  'milestone.rollup.health': 'Health',
  'milestone.rollup.keyOutcome': 'Key outcome',
  'milestone.rollup.noOutcome': 'No outcome yet',
  'milestone.field.startDate': 'Start',
  'milestone.field.targetDate': 'Target',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtDate: (d: string) => d }),
}))

import { render, screen, fireEvent, within } from '@testing-library/react'
import type { TaskStatus } from '@prisma/client'
import { MilestoneHero } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneHero'
import type { MilestoneWeightedProgress } from '@/lib/summaries/milestone-weighted-progress'

const taskCounts: Record<TaskStatus, number> = {
  TODO: 1,
  IN_PROGRESS: 1,
  IN_REVIEW: 0,
  DONE: 2,
}

const baseProps = {
  name: 'Q3',
  taskCounts,
  health: null,
  startDate: null,
  derivedStartDate: null,
  targetDate: null,
  summaryTldr: null,
  sprintCoverage: null,
  onUpdate: () => {},
}

const renderHero = (weightedProgress: MilestoneWeightedProgress | null) =>
  render(<MilestoneHero {...baseProps} weightedProgress={weightedProgress} />)

describe('MilestoneHero dual-read', () => {
  it('preserves the task-count reading (done/total) by default', () => {
    // 2 of 4 tasks done → 50%.
    renderHero({
      doneWeight: 30,
      totalWeight: 100,
      pct: 30,
      measuredTasks: 3,
      totalTasks: 4,
    })
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('2/4 tasks')).toBeInTheDocument()
    // The weighted % is NOT shown until toggled.
    expect(screen.queryByText('30%')).not.toBeInTheDocument()
  })

  it('toggles the same ring to the complexity-weighted reading with coverage', () => {
    renderHero({
      doneWeight: 30,
      totalWeight: 100,
      pct: 30,
      measuredTasks: 3,
      totalTasks: 4,
    })
    fireEvent.click(screen.getByRole('button', { name: 'By complexity' }))
    // Ring now shows the weighted %, not the task-count %.
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.queryByText('50%')).not.toBeInTheDocument()
    // Coverage is surfaced (measured 3 of 4).
    expect(screen.getByText('weighted · 3/4 measured')).toBeInTheDocument()
  })

  it('reads an explicit Unavailable, never 0%, when no task is measured', () => {
    renderHero({
      doneWeight: null,
      totalWeight: null,
      pct: null,
      measuredTasks: 0,
      totalTasks: 4,
    })
    fireEvent.click(screen.getByRole('button', { name: 'By complexity' }))
    expect(screen.getByText('No complexity data yet')).toBeInTheDocument()
    // The task-count 0% must not leak in as a fabricated weighted reading.
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('hides the dual-read toggle entirely when the server sent no weighted reading', () => {
    renderHero(null)
    expect(
      screen.queryByRole('group', { name: 'Progress reading' })
    ).not.toBeInTheDocument()
    // Task-count reading still renders on its own.
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('marks the active reading via aria-pressed', () => {
    renderHero({
      doneWeight: 30,
      totalWeight: 100,
      pct: 30,
      measuredTasks: 3,
      totalTasks: 4,
    })
    const group = screen.getByRole('group', { name: 'Progress reading' })
    const tasksBtn = within(group).getByRole('button', {
      name: 'By task count',
    })
    const complexityBtn = within(group).getByRole('button', {
      name: 'By complexity',
    })
    expect(tasksBtn).toHaveAttribute('aria-pressed', 'true')
    expect(complexityBtn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(complexityBtn)
    expect(complexityBtn).toHaveAttribute('aria-pressed', 'true')
    expect(tasksBtn).toHaveAttribute('aria-pressed', 'false')
  })
})
