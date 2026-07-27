/** @jest-environment jsdom */

/**
 * Mock react-intl to avoid the untranspiled-ESM transform issue under jest.
 * formatMessage falls back to defaultMessage so aria-label assertions work.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      defaultMessage,
      id,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DisplayOptionsMenu',
  () => ({
    DisplayOptionsMenu: () => <div data-testid='display-options-menu' />,
  })
)

jest.mock('@/app/workspace/[workspaceUrl]/components/ViewToggle', () => ({
  ViewToggle: () => <div data-testid='view-toggle' />,
}))

import { render, screen } from '@testing-library/react'
import { TaskListToolbar } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskListToolbar'
import type { CompletedFilter } from '@/app/workspace/[workspaceUrl]/utils/filterCompletedTasks'
import type { TaskOrdering } from '@/app/workspace/[workspaceUrl]/utils/sortTasks'

const baseProps = {
  completedFilter: 'all' as CompletedFilter,
  onCompletedFilterChange: () => {},
  ordering: 'manual' as TaskOrdering,
  onOrderingChange: () => {},
  showSubtasks: false,
  onShowSubtasksChange: () => {},
  viewMode: 'list' as const,
  onViewModeChange: () => {},
}

describe('TaskListToolbar', () => {
  it('renders left-slot children', () => {
    render(
      <TaskListToolbar {...baseProps} leftSlot={<button>仅当前冲刺</button>} />
    )
    expect(screen.getByText('仅当前冲刺')).toBeInTheDocument()
    expect(screen.getByTestId('display-options-menu')).toBeInTheDocument()
    expect(screen.getByTestId('view-toggle')).toBeInTheDocument()
  })

  it('does not render the collapse button when onToggleSidebar is omitted', () => {
    render(<TaskListToolbar {...baseProps} />)
    // Neither "Hide sprint details" nor "Show sprint details" should be present
    expect(screen.queryByLabelText(/hide sprint details/i)).toBeNull()
    expect(screen.queryByLabelText(/show sprint details/i)).toBeNull()
  })

  it('renders the collapse button when onToggleSidebar is provided', () => {
    render(
      <TaskListToolbar
        {...baseProps}
        sidebarCollapsed={false}
        onToggleSidebar={() => {}}
      />
    )
    // sidebarCollapsed=false → sprints.detail.collapseSidebar → defaultMessage "Hide sprint details"
    expect(screen.getByLabelText(/hide sprint details/i)).toBeInTheDocument()
  })

  it('shows the expand label when sidebar is collapsed', () => {
    render(
      <TaskListToolbar
        {...baseProps}
        sidebarCollapsed={true}
        onToggleSidebar={() => {}}
      />
    )
    expect(screen.getByLabelText(/show sprint details/i)).toBeInTheDocument()
  })
})
