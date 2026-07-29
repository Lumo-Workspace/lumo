/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { defaultMessage, id }: { id: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      const template = defaultMessage ?? id
      if (!values) return template
      return template.replace(/\{(\w+)\}/g, (_m, k) => String(values[k] ?? ''))
    },
  }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import { TaskFilterChips } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskFilterChips'
import type { FilterableTask } from '@/app/workspace/[workspaceUrl]/utils/filterTasks'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

function task(overrides: Partial<FilterableTask> = {}): FilterableTask {
  return {
    status: 'TODO',
    priority: 'MEDIUM',
    assigneeActorId: null,
    projectId: 'proj_a',
    project: { name: 'Alpha' },
    dueDate: null,
    ...overrides,
  }
}

const members: WorkspaceMemberInfo[] = [
  {
    id: 'm1',
    clerkId: 'c1',
    role: 'member',
    name: 'Ada Lovelace',
    email: null,
    imageUrl: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    actorId: 'actor_1',
  },
]

function renderChips(
  filters: Parameters<typeof TaskFilterChips>[0]['filters'],
  tasks: FilterableTask[] = [task()]
) {
  const onClearDimension = jest.fn()
  const onClearAll = jest.fn()
  const { container } = render(
    <TaskFilterChips
      tasks={tasks}
      filters={filters}
      members={members}
      onClearDimension={onClearDimension}
      onClearAll={onClearAll}
    />
  )
  return { onClearDimension, onClearAll, container }
}

describe('TaskFilterChips', () => {
  it('renders nothing when no filter is active', () => {
    const { container } = renderChips({})
    expect(container).toBeEmptyDOMElement()
  })

  it('names the dimension and its value on each chip', () => {
    renderChips({ status: ['IN_PROGRESS'], priority: ['HIGH'] })

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Priority')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('summarises a multi-value dimension as "first +N"', () => {
    renderChips({ status: ['TODO', 'IN_PROGRESS', 'DONE'] })
    expect(screen.getByText('Todo +2')).toBeInTheDocument()
  })

  it('removes only the chip that was dismissed', () => {
    const { onClearDimension, onClearAll } = renderChips({
      status: ['TODO'],
      priority: ['HIGH'],
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Status filter' })
    )

    expect(onClearDimension).toHaveBeenCalledTimes(1)
    expect(onClearDimension).toHaveBeenCalledWith('status')
    expect(onClearAll).not.toHaveBeenCalled()
  })

  it('offers a clear-all that drops every dimension at once', () => {
    const { onClearAll, onClearDimension } = renderChips({
      status: ['TODO'],
      dueDate: ['overdue'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(onClearAll).toHaveBeenCalledTimes(1)
    expect(onClearDimension).not.toHaveBeenCalled()
  })

  it('labels assignee and project chips from the tasks in scope', () => {
    renderChips({ assignee: ['actor_1'], project: ['proj_a'] }, [
      task({ assigneeActorId: 'actor_1' }),
    ])

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('labels sprint and milestone chips from the tasks in scope', () => {
    renderChips({ sprint: ['s1'], milestone: ['m1'] }, [
      task({
        sprintId: 's1',
        sprint: { name: 'Sprint 12' },
        milestoneId: 'm1',
        milestone: { name: 'Q3 Launch' },
      }),
    ])

    expect(screen.getByText('Sprint')).toBeInTheDocument()
    expect(screen.getByText('Sprint 12')).toBeInTheDocument()
    expect(screen.getByText('Milestone')).toBeInTheDocument()
    expect(screen.getByText('Q3 Launch')).toBeInTheDocument()
  })

  it('renders one chip per active dimension, in canonical order', () => {
    renderChips({ dueDate: ['today'], sprint: ['s1'], status: ['TODO'] })
    const removeButtons = screen.getAllByRole('button', { name: /^Remove / })
    expect(removeButtons.map(b => b.getAttribute('aria-label'))).toEqual([
      'Remove Status filter',
      'Remove Sprint filter',
      'Remove Due date filter',
    ])
  })
})
