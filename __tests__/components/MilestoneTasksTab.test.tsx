/** @jest-environment jsdom */

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSprintCoverage',
  () => ({
    MilestoneSprintCoverage: ({ coverage }: { coverage: unknown }) => (
      <div data-testid='coverage'>{coverage ? 'has-coverage' : 'no-coverage'}</div>
    ),
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/TaskListByMilestone',
  () => ({
    TaskListByMilestone: ({
      projectId,
      milestoneId,
    }: {
      projectId: string
      milestoneId: string
    }) => <div data-testid='tasklist'>{`${projectId}:${milestoneId}`}</div>,
  })
)

import { render, screen } from '@testing-library/react'
import { MilestoneTasksTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab'

test('renders sprint coverage and the milestone task list', () => {
  render(
    <MilestoneTasksTab projectId='p1' milestoneId='m1' sprintCoverage={null} />
  )
  expect(screen.getByTestId('coverage').textContent).toBe('no-coverage')
  expect(screen.getByTestId('tasklist').textContent).toBe('p1:m1')
})
