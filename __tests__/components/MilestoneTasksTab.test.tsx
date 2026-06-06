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
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksWorkspace',
  () => ({
    MilestoneTasksWorkspace: ({ milestoneId }: { milestoneId: string }) => (
      <div data-testid='workspace'>{milestoneId}</div>
    ),
  })
)

import { render, screen } from '@testing-library/react'
import { MilestoneTasksTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTasksTab'

test('renders sprint coverage and the milestone task workspace', () => {
  render(
    <MilestoneTasksTab
      milestoneId='m1'
      sprintCoverage={null}
      sidebarCollapsed={false}
      onToggleSidebar={() => {}}
      onOpenTask={() => {}}
    />
  )
  expect(screen.getByTestId('coverage').textContent).toBe('no-coverage')
  expect(screen.getByTestId('workspace').textContent).toBe('m1')
})
