jest.mock('@/lib/api-client', () => ({
  tasksClient: { update: jest.fn() },
  apiFetch: jest.fn(),
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}))

import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import { useBoardDrag } from '@/app/workspace/[workspaceUrl]/hooks/useBoardDrag'
import { tasksClient, apiFetch } from '@/lib/api-client'
import { toast } from 'sonner'

const mockUpdate = tasksClient.update as jest.Mock
const mockApiFetch = apiFetch as jest.Mock
const mockToastError = toast.error as jest.Mock

type Task = { id: string; status: string; viewOrder: number | null }

// dnd-kit's event types carry a lot of fields the hook never reads. Build the
// minimal shape the hook actually destructures ({ active, over }) and cast.
function dragEvent(activeId: string, overId: string | null) {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragOverEvent & DragEndEvent
}

/**
 * Mirrors the real wiring: the parent owns `tasks` in state and feeds it back
 * into the hook on every render. This is what makes the hook re-derive fresh
 * closures after an optimistic setTasks — exactly like the live SprintTasksView.
 */
function useHarness(initial: Task[], onStatusChanged?: jest.Mock) {
  const [tasks, setTasks] = useState<Task[]>(initial)
  // viewId: null mirrors the sprint board — sprints don't own a kanban View,
  // so only the cross-column status PATCH runs (no ViewTaskOrder persistence).
  const drag = useBoardDrag<Task>({
    tasks,
    setTasks,
    viewId: null,
    ...(onStatusChanged ? { onStatusChanged } : {}),
  })
  return { tasks, ...drag }
}

const COLUMNS: Task[] = [
  { id: 't1', status: 'TODO', viewOrder: 0 },
  { id: 't2', status: 'IN_PROGRESS', viewOrder: 0 },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockResolvedValue(undefined)
  mockApiFetch.mockResolvedValue(undefined)
})

describe('useBoardDrag — optimistic cross-column status drag', () => {
  it('onDragOver moves the card to the target column immediately, before any API call (no snap-back)', () => {
    const { result } = renderHook(() => useHarness(COLUMNS))

    act(() => result.current.onDragStart({ active: { id: 't1' } }))
    act(() => result.current.onDragOver(dragEvent('t1', 'IN_PROGRESS')))

    // The whole point of the task: the card sits in the new column right away…
    expect(result.current.tasks.find(t => t.id === 't1')?.status).toBe(
      'IN_PROGRESS'
    )
    // …and we have NOT waited on (or even fired) the server PATCH yet.
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('onDragEnd commits the move with a single status PATCH and notifies onStatusChanged', async () => {
    const onStatusChanged = jest.fn()
    const { result } = renderHook(() => useHarness(COLUMNS, onStatusChanged))

    act(() => result.current.onDragStart({ active: { id: 't1' } }))
    act(() => result.current.onDragOver(dragEvent('t1', 'IN_PROGRESS')))
    await act(async () => {
      await result.current.onDragEnd(dragEvent('t1', 'IN_PROGRESS'))
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith('t1', { status: 'IN_PROGRESS' })
    // viewId is null → no ViewTaskOrder PATCH for the sprint board.
    expect(mockApiFetch).not.toHaveBeenCalled()
    expect(onStatusChanged).toHaveBeenCalledWith('t1', 'TODO', 'IN_PROGRESS')
    expect(result.current.tasks.find(t => t.id === 't1')?.status).toBe(
      'IN_PROGRESS'
    )
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('rolls the card back to its original column and toasts when the PATCH fails', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('network down'))
    const onStatusChanged = jest.fn()
    const { result } = renderHook(() => useHarness(COLUMNS, onStatusChanged))

    act(() => result.current.onDragStart({ active: { id: 't1' } }))
    act(() => result.current.onDragOver(dragEvent('t1', 'IN_PROGRESS')))
    // Optimistically moved before the failure resolves.
    expect(result.current.tasks.find(t => t.id === 't1')?.status).toBe(
      'IN_PROGRESS'
    )

    await act(async () => {
      await result.current.onDragEnd(dragEvent('t1', 'IN_PROGRESS'))
    })

    // Snapshot rollback restores the starting column.
    expect(result.current.tasks.find(t => t.id === 't1')?.status).toBe('TODO')
    expect(mockToastError).toHaveBeenCalledWith('Failed to move task')
    expect(onStatusChanged).not.toHaveBeenCalled()
  })

  it('is a no-op when the card is dropped back in its own column (sprint board, no View ordering)', async () => {
    const { result } = renderHook(() => useHarness(COLUMNS))

    act(() => result.current.onDragStart({ active: { id: 't1' } }))
    act(() => result.current.onDragOver(dragEvent('t1', 'TODO')))
    await act(async () => {
      await result.current.onDragEnd(dragEvent('t1', 'TODO'))
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockApiFetch).not.toHaveBeenCalled()
    expect(result.current.tasks.find(t => t.id === 't1')?.status).toBe('TODO')
  })
})
