/**
 * Mock react-intl to avoid ESM transform issues under jest.
 */
const messages: Record<string, string> = {
  'summary.projectsAtGlance': 'Projects at a glance',
  'summary.filterAll': 'All',
  'summary.riskLevel.healthy': 'Healthy',
  'summary.riskLevel.watch': 'Watch',
  'summary.riskLevel.atRisk': 'At risk',
  'summary.riskLevel.unassessed': 'Not assessed',
  'summary.overdue': 'Overdue',
  'summary.noProjectsMatchFilter': 'No projects match this filter',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => messages[id] ?? defaultMessage ?? id,
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProjectsAtGlanceList } from '@/app/workspace/[workspaceUrl]/components/summary/ProjectsAtGlanceList'
import type { WorkspaceSummaryStats } from '@/types/summary'

const projects: WorkspaceSummaryStats['projectBreakdown'] = [
  {
    projectId: 'p1',
    projectName: 'Alpha',
    totalTasks: 20,
    completedTasks: 12,
    overdueTasks: 7,
    risk: {
      level: 'at-risk',
      score: 5,
      reasons: [
        { code: 'overdue_ratio_high', detail: '7/20 tasks overdue (35%)' },
      ],
    },
  },
  {
    projectId: 'p2',
    projectName: 'Bravo',
    totalTasks: 10,
    completedTasks: 9,
    overdueTasks: 0,
    risk: { level: 'healthy', score: 0, reasons: [] },
  },
  {
    projectId: 'p3',
    projectName: 'Charlie',
    totalTasks: 15,
    completedTasks: 10,
    overdueTasks: 2,
    risk: { level: 'watch', score: 3, reasons: [] },
  },
]

describe('ProjectsAtGlanceList', () => {
  it('renders projects sorted with at-risk first', () => {
    render(<ProjectsAtGlanceList projects={projects} onNavigate={() => {}} />)
    const names = screen
      .getAllByTestId('project-row-name')
      .map(n => n.textContent)
    expect(names).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('calls onNavigate when a row is clicked', () => {
    const onNavigate = jest.fn()
    render(<ProjectsAtGlanceList projects={projects} onNavigate={onNavigate} />)
    const rows = screen.getAllByTestId('project-row')
    fireEvent.click(rows[0]!)
    expect(onNavigate).toHaveBeenCalledWith('p1')
  })

  it('renders nothing when projects array is empty', () => {
    const { container } = render(
      <ProjectsAtGlanceList projects={[]} onNavigate={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })
})
