/** @jest-environment jsdom */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

const useVirtualizerMock = jest.fn((_opts: { count: number }) => ({
  getTotalSize: () => 0,
  getVirtualItems: () => [] as Array<{ index: number; start: number }>,
  measureElement: () => {},
}))
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => useVirtualizerMock(opts),
}))

// Capture the items passed to every SortableContext.
const sortableItemsSeen: string[][] = []
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({
    items,
    children,
  }: {
    items: string[]
    children: React.ReactNode
  }) => {
    sortableItemsSeen.push(items)
    return children
  },
  verticalListSortingStrategy: 'vertical',
}))
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  DragOverlay: ({ children }: { children: React.ReactNode }) => children,
  useDroppable: () => ({ setNodeRef: () => {} }),
  closestCorners: jest.fn(),
  defaultDropAnimationSideEffects: () => ({}),
}))

import { render } from '@testing-library/react'
import { BoardView } from '@/app/workspace/[workspaceUrl]/components/board/BoardView'
import { BOARD_COLUMN_VIRTUALIZE_THRESHOLD } from '@/lib/utils/shouldVirtualize'

type Task = { id: string; viewOrder: number | null; status: string }

function makeTasks(n: number, status: string): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${status}-${i}`,
    viewOrder: i,
    status,
  }))
}

function renderBoard(tasks: Task[]) {
  return render(
    <BoardView<Task>
      tasks={tasks}
      sensors={[]}
      activeId={null}
      onDragStart={jest.fn()}
      onDragOver={jest.fn()}
      onDragEnd={jest.fn()}
      renderCard={t => <div data-testid={`card-${t.id}`}>{t.id}</div>}
    />
  )
}

describe('BoardView virtualization', () => {
  beforeEach(() => {
    useVirtualizerMock.mockClear()
    sortableItemsSeen.length = 0
  })

  it('virtualizes a column over the threshold and not one under it', () => {
    renderBoard([
      ...makeTasks(BOARD_COLUMN_VIRTUALIZE_THRESHOLD + 3, 'TODO'),
      ...makeTasks(2, 'IN_PROGRESS'),
    ])
    expect(useVirtualizerMock).toHaveBeenCalledTimes(1)
    const calls = useVirtualizerMock.mock.calls
    const first = calls.length > 0 ? calls[0] : undefined
    expect(first?.[0]?.count).toBe(BOARD_COLUMN_VIRTUALIZE_THRESHOLD + 3)
  })

  it('always passes the full id list to SortableContext, even when virtualized', () => {
    const todo = makeTasks(BOARD_COLUMN_VIRTUALIZE_THRESHOLD + 3, 'TODO')
    renderBoard(todo)
    const todoIds = todo.map(t => t.id).sort()
    const seen = sortableItemsSeen.find(arr => arr.length === todo.length)
    expect(seen?.slice().sort()).toEqual(todoIds)
  })
})

describe('BoardView backlog column (LUM-1057)', () => {
  it('hides the Backlog column when no task is in BACKLOG', () => {
    const { queryByText } = renderBoard(makeTasks(1, 'TODO'))
    // Column headers are localized: the mocked formatMessage echoes the id.
    expect(queryByText('status.backlog')).toBeNull()
    expect(queryByText('status.todo')).not.toBeNull()
  })

  it('shows a Backlog column once a task is in BACKLOG', () => {
    const { getByText, getByTestId } = renderBoard([
      ...makeTasks(1, 'BACKLOG'),
      ...makeTasks(1, 'TODO'),
    ])
    expect(getByText('status.backlog')).not.toBeNull()
    expect(getByTestId('card-BACKLOG-0')).not.toBeNull()
  })
})
