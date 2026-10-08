import { act, renderHook } from '@testing-library/react'
import { useWorkspaceModalState } from '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceModalState'

// LUM-1045: "Create Task" on My Tasks pre-filled the assignee with the
// WorkspaceMember id, but the assignee picker and the task API both work in
// actor ids, so the create request failed with "Assignee is not part of this
// workspace". The default must be the current user's actor id.
describe('useWorkspaceModalState — new task for me', () => {
  const base = {
    onOpenTaskSideEffect: jest.fn(),
    onOpenNewTaskModal: jest.fn(),
    saveDraft: jest.fn(),
    deleteDraft: jest.fn(),
  }

  it('defaults the assignee to the current actor id, not the member id', () => {
    const { result } = renderHook(() =>
      useWorkspaceModalState({
        ...base,
        currentActorId: 'actor_456',
      })
    )

    act(() => result.current.openNewTaskModalForMe('TODO'))

    expect(result.current.isNewTaskModalOpen).toBe(true)
    expect(result.current.newTaskDefaultAssigneeId).toBe('actor_456')
    expect(base.onOpenNewTaskModal).toHaveBeenCalledWith('actor_456', 'TODO')
  })

  it('leaves the assignee empty when the current user has no actor yet', () => {
    const { result } = renderHook(() =>
      useWorkspaceModalState({
        ...base,
        currentActorId: null,
      })
    )

    act(() => result.current.openNewTaskModalForMe())

    expect(result.current.newTaskDefaultAssigneeId).toBeUndefined()
  })
})
