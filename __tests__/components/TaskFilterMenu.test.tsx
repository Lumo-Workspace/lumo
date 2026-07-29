/** @jest-environment jsdom */

/**
 * Mock react-intl so formatMessage falls back to defaultMessage — the labels
 * asserted below are then the real English copy the component ships.
 */
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
import { TaskFilterMenu } from '@/app/workspace/[workspaceUrl]/components/task-list/TaskFilterMenu'
import type { FilterableTask } from '@/app/workspace/[workspaceUrl]/utils/filterTasks'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

const NOW = new Date(2026, 6, 29, 12, 0, 0).getTime()

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
  {
    id: 'm2',
    clerkId: 'c2',
    role: 'member',
    name: 'Grace Hopper',
    email: null,
    imageUrl: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    actorId: 'actor_2',
  },
]

function renderMenu(
  tasks: FilterableTask[],
  opts: {
    filters?: Parameters<typeof TaskFilterMenu>[0]['filters']
    now?: number | null
    onToggleValue?: jest.Mock
  } = {}
) {
  const onToggleValue = opts.onToggleValue ?? jest.fn()
  render(
    <TaskFilterMenu
      tasks={tasks}
      filters={opts.filters ?? {}}
      members={members}
      now={opts.now === undefined ? NOW : opts.now}
      onToggleValue={onToggleValue}
    />
  )
  return { onToggleValue }
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /filter/i }))
}

describe('TaskFilterMenu', () => {
  it('renders a labelled Filter trigger', () => {
    renderMenu([task(), task({ status: 'DONE' })])
    expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument()
  })

  it('only offers dimensions that can narrow the current scope', () => {
    // One project, one assignee, two statuses → Status narrows, the others cannot.
    renderMenu([
      task({ status: 'TODO', assigneeActorId: 'actor_1' }),
      task({ status: 'DONE', assigneeActorId: 'actor_1' }),
    ])
    openMenu()

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.queryByText('Project')).toBeNull()
    expect(screen.queryByText('Assignee')).toBeNull()
    expect(screen.queryByText('Priority')).toBeNull()
  })

  it('offers project and assignee once the scope spans more than one', () => {
    renderMenu([
      task({ projectId: 'proj_a', assigneeActorId: 'actor_1' }),
      task({
        projectId: 'proj_b',
        project: { name: 'Beta' },
        assigneeActorId: 'actor_2',
      }),
    ])
    openMenu()

    expect(screen.getByText('Project')).toBeInTheDocument()
    expect(screen.getByText('Assignee')).toBeInTheDocument()
  })

  it('lists a dimension’s values with counts, labelled from the tasks in scope', () => {
    renderMenu([
      task({ status: 'TODO' }),
      task({ status: 'TODO' }),
      task({ status: 'IN_PROGRESS' }),
    ])
    openMenu()
    fireEvent.click(screen.getByText('Status'))

    expect(screen.getByText('Todo')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    // Canonical order, not insertion order.
    const values = screen
      .getAllByRole('button')
      .map(b => b.textContent ?? '')
      .filter(t => t.includes('Todo') || t.includes('In Progress'))
    expect(values[0]).toContain('Todo')
    expect(values[0]).toContain('2')
    expect(values[1]).toContain('In Progress')
    expect(values[1]).toContain('1')
  })

  it('labels assignee values with member names and marks unassigned tasks', () => {
    renderMenu([
      task({ assigneeActorId: 'actor_1' }),
      task({ assigneeActorId: null }),
    ])
    openMenu()
    fireEvent.click(screen.getByText('Assignee'))

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.queryByText('actor_1')).toBeNull()
  })

  it('labels tag values by tag name and offers a no-label bucket', () => {
    renderMenu([
      task({ tags: [{ id: 'tag_1', name: 'bug' }] }),
      task({ tags: [] }),
    ])
    openMenu()
    fireEvent.click(screen.getByText('Label'))

    expect(screen.getByText('bug')).toBeInTheDocument()
    expect(screen.getByText('No label')).toBeInTheDocument()
  })

  it('reports the selected value up as (dimension, value)', () => {
    const { onToggleValue } = renderMenu([
      task({ status: 'TODO' }),
      task({ status: 'DONE' }),
    ])
    openMenu()
    fireEvent.click(screen.getByText('Status'))
    fireEvent.click(screen.getByText('Done'))

    expect(onToggleValue).toHaveBeenCalledWith('status', 'DONE')
  })

  it('badges the trigger with the number of active dimensions', () => {
    renderMenu([task({ status: 'TODO' }), task({ status: 'DONE' })], {
      filters: { status: ['TODO'], priority: ['HIGH'] },
    })
    const trigger = screen.getByRole('button', { name: /filter/i })
    expect(trigger.textContent).toContain('2')
  })

  it('keeps offering a dimension that is already filtered, even when it no longer narrows', () => {
    renderMenu([task({ projectId: 'proj_a' })], {
      filters: { project: ['proj_a'] },
    })
    openMenu()
    expect(screen.getByText('Project')).toBeInTheDocument()
  })

  it('withholds the due-date dimension until the clock is known', () => {
    const tasks = [
      task({ dueDate: new Date(2026, 6, 20).toISOString() }),
      task({ dueDate: new Date(2026, 7, 30).toISOString() }),
    ]

    const { unmount } = render(
      <TaskFilterMenu
        tasks={tasks}
        filters={{}}
        members={members}
        now={null}
        onToggleValue={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /filter/i }))
    expect(screen.queryByText('Due date')).toBeNull()
    unmount()

    renderMenu(tasks)
    openMenu()
    expect(screen.getByText('Due date')).toBeInTheDocument()
  })

  it('can walk back from a value list to the dimension list', () => {
    renderMenu([task({ status: 'TODO' }), task({ status: 'DONE' })])
    openMenu()
    fireEvent.click(screen.getByText('Status'))
    expect(screen.getByText('Todo')).toBeInTheDocument()

    // The sub-menu header doubles as the back control.
    fireEvent.click(screen.getByText('Status'))
    expect(screen.queryByText('Todo')).toBeNull()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })
})
