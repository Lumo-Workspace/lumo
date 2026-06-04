/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) =>
      ({
        'milestone.tab.overview': 'Overview',
        'milestone.tab.tasks': 'Tasks',
      })[id] ?? id,
  }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab',
  () => ({
    MilestoneOverviewTab: () => <div data-testid='overview-body'>overview</div>,
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab',
  () => ({
    MilestoneTasksTab: () => <div data-testid='tasks-body'>tasks</div>,
  })
)

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneDetailTabs } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailTabs'

const milestone = {
  id: 'm1',
  projectId: 'p1',
  name: 'Beta',
  description: null,
  sprintCoverage: null,
} as never

test('defaults to the overview tab', () => {
  render(<MilestoneDetailTabs milestone={milestone} onUpdate={() => {}} />)
  expect(screen.getByTestId('overview-body')).toBeTruthy()
  expect(screen.queryByTestId('tasks-body')).toBeNull()
})

test('clicking Tasks switches to the tasks body, and back', async () => {
  const user = userEvent.setup()
  render(<MilestoneDetailTabs milestone={milestone} onUpdate={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Tasks' }))
  expect(screen.getByTestId('tasks-body')).toBeTruthy()
  expect(screen.queryByTestId('overview-body')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Overview' }))
  expect(screen.getByTestId('overview-body')).toBeTruthy()
  expect(screen.queryByTestId('tasks-body')).toBeNull()
})
