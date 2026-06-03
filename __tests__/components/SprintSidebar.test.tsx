/**
 * Focused on the new Health block (risk badge + reasons + top blockers).
 * Heavy children (date pickers, member/priority breakdown, api-client) are
 * mocked so the test exercises only the sidebar's risk rendering.
 */
const messages: Record<string, string> = {
  'sprints.detail.health': 'Health',
  'sprints.detail.progress': 'Progress',
  'summary.topBlockers': 'Top blockers',
  'summary.riskLevel.healthy': 'Healthy',
  'summary.riskLevel.watch': 'Watch',
  'summary.riskLevel.atRisk': 'At risk',
  'summary.riskLevel.unassessed': 'Not assessed',
  'summary.blockerGroup.overdue': 'Overdue tasks',
  'summary.blockerGroup.stalled': 'Stalled tasks',
  'summary.blockerGroup.failingAgents': 'Failing agents',
  'summary.blockerGroup.stalePrs': 'Stale PRs',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/api-client', () => ({ sprintsClient: { update: jest.fn() } }))
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/DatePickerField',
  () => ({
    DatePickerField: () => null,
    startOfDay: (d: Date) => d,
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/fields/shared', () => ({
  PriorityIcon: () => null,
  PRIORITY_CONFIG: {},
  MemberAvatar: () => null,
}))
jest.mock('@/lib/services/sprint-breakdown', () => ({
  priorityBreakdown: () => [],
  memberBreakdown: () => [],
}))
jest.mock('@/lib/services/sprint-date', () => ({
  deriveSprintState: () => 'CURRENT',
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { SprintSidebar } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintSidebar'
import type { RiskAssessment, TopBlockers } from '@/types/summary'

const sprint = {
  id: 'sp-1',
  number: 3,
  name: 'Sprint 3',
  startDate: '2026-06-01T00:00:00.000Z',
  endDate: '2026-06-14T23:59:59.000Z',
} as never

const baseProps = {
  sprint,
  progress: { done: 4, total: 10 },
  tasks: [],
  members: [],
  onRefresh: () => {},
}

describe('SprintSidebar — Health block', () => {
  it('omits the Health block entirely when risk is null', () => {
    render(<SprintSidebar {...baseProps} risk={null} topBlockers={null} />)
    expect(screen.queryByText('Health')).not.toBeInTheDocument()
    expect(screen.queryByText('Top blockers')).not.toBeInTheDocument()
  })

  it('renders the risk badge, reason line, and blocker groups', () => {
    const risk: RiskAssessment = {
      level: 'at-risk',
      score: 5,
      reasons: [
        { code: 'overdue_ratio_high', detail: '4/10 tasks overdue (40%)' },
        { code: 'stalled_tasks', detail: '3 tasks with no progress in 7 days' },
      ],
    }
    const topBlockers: TopBlockers = {
      overdueTaskIds: [
        { id: 't1', identifier: 'LUM-1', title: 'Fix login' },
        { id: 't8', identifier: 'LUM-8', title: 'Wire API' },
      ],
      stalledTaskIds: [{ id: 't5', identifier: 'LUM-5', title: 'Add tests' }],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [12, 15],
    }
    render(
      <SprintSidebar {...baseProps} risk={risk} topBlockers={topBlockers} />
    )
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('At risk')).toBeInTheDocument()
    expect(
      screen.getByText(
        '4/10 tasks overdue (40%), 3 tasks with no progress in 7 days'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Top blockers')).toBeInTheDocument()
    expect(screen.getByText('Overdue tasks')).toBeInTheDocument()
    expect(screen.getByText('LUM-1, LUM-8')).toBeInTheDocument()
    expect(screen.getByText('Stalled tasks')).toBeInTheDocument()
    expect(screen.getByText('#12, #15')).toBeInTheDocument()
    // failingAgents group is empty → not rendered
    expect(screen.queryByText('Failing agents')).not.toBeInTheDocument()
  })

  it('shows the Health badge but no blockers section when all blockers empty', () => {
    const risk: RiskAssessment = { level: 'healthy', score: 0, reasons: [] }
    const topBlockers: TopBlockers = {
      overdueTaskIds: [],
      stalledTaskIds: [],
      failingAgentTaskIds: [],
      staleOpenPrNumbers: [],
    }
    render(
      <SprintSidebar {...baseProps} risk={risk} topBlockers={topBlockers} />
    )
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
    expect(screen.queryByText('Top blockers')).not.toBeInTheDocument()
  })
})
