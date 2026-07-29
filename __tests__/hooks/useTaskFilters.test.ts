/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { useTaskFilters } from '@/app/workspace/[workspaceUrl]/hooks/useTaskFilters'

const SPRINT_SCOPE = 'lumo:display:sprint:s1'
const MY_TASKS_SCOPE = 'lumo:display:my-tasks'

describe('useTaskFilters', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts with an empty selection when nothing is stored', () => {
    const { result } = renderHook(() => useTaskFilters(SPRINT_SCOPE))
    expect(result.current.filters).toEqual({})
  })

  it('persists a selection under the scope key with a :filters suffix', () => {
    const { result } = renderHook(() => useTaskFilters(SPRINT_SCOPE))

    act(() => result.current.toggleValue('status', 'IN_PROGRESS'))

    expect(result.current.filters).toEqual({ status: ['IN_PROGRESS'] })
    expect(localStorage.getItem(`${SPRINT_SCOPE}:filters`)).toBe(
      JSON.stringify({ status: ['IN_PROGRESS'] })
    )
  })

  it('survives a remount under the same scope key', () => {
    const first = renderHook(() => useTaskFilters(SPRINT_SCOPE))
    act(() => first.result.current.toggleValue('priority', 'HIGH'))
    first.unmount()

    const second = renderHook(() => useTaskFilters(SPRINT_SCOPE))
    expect(second.result.current.filters).toEqual({ priority: ['HIGH'] })
  })

  it('keeps scopes isolated from each other', () => {
    const sprint = renderHook(() => useTaskFilters(SPRINT_SCOPE))
    act(() => sprint.result.current.toggleValue('status', 'DONE'))

    const myTasks = renderHook(() => useTaskFilters(MY_TASKS_SCOPE))
    expect(myTasks.result.current.filters).toEqual({})
    expect(sprint.result.current.filters).toEqual({ status: ['DONE'] })
  })

  it('accumulates values within a dimension and across dimensions', () => {
    const { result } = renderHook(() => useTaskFilters(SPRINT_SCOPE))

    act(() => result.current.toggleValue('status', 'TODO'))
    act(() => result.current.toggleValue('status', 'IN_PROGRESS'))
    act(() => result.current.toggleValue('priority', 'URGENT'))

    expect(result.current.filters).toEqual({
      status: ['TODO', 'IN_PROGRESS'],
      priority: ['URGENT'],
    })
  })

  it('toggling the last value in a dimension drops the dimension', () => {
    const { result } = renderHook(() => useTaskFilters(SPRINT_SCOPE))

    act(() => result.current.toggleValue('status', 'TODO'))
    act(() => result.current.toggleValue('status', 'TODO'))

    expect(result.current.filters).toEqual({})
    expect(localStorage.getItem(`${SPRINT_SCOPE}:filters`)).toBeNull()
  })

  it('clearDimension removes only that dimension', () => {
    const { result } = renderHook(() => useTaskFilters(SPRINT_SCOPE))

    act(() => result.current.toggleValue('status', 'TODO'))
    act(() => result.current.toggleValue('priority', 'HIGH'))
    act(() => result.current.clearDimension('status'))

    expect(result.current.filters).toEqual({ priority: ['HIGH'] })
  })

  it('clearAll empties the selection and the stored entry', () => {
    const { result } = renderHook(() => useTaskFilters(SPRINT_SCOPE))

    act(() => result.current.toggleValue('status', 'TODO'))
    act(() => result.current.toggleValue('dueDate', 'overdue'))
    act(() => result.current.clearAll())

    expect(result.current.filters).toEqual({})
    expect(localStorage.getItem(`${SPRINT_SCOPE}:filters`)).toBeNull()
  })

  it('keeps two boards on the same scope in sync', () => {
    const a = renderHook(() => useTaskFilters(SPRINT_SCOPE))
    const b = renderHook(() => useTaskFilters(SPRINT_SCOPE))

    act(() => a.result.current.toggleValue('status', 'IN_REVIEW'))

    expect(b.result.current.filters).toEqual({ status: ['IN_REVIEW'] })
  })

  it('ignores a corrupt or foreign stored payload', () => {
    localStorage.setItem(`${SPRINT_SCOPE}:filters`, '{not json')
    const corrupt = renderHook(() => useTaskFilters(SPRINT_SCOPE))
    expect(corrupt.result.current.filters).toEqual({})

    localStorage.setItem(
      `${SPRINT_SCOPE}:filters`,
      JSON.stringify({ bogus: ['x'], status: ['TODO'] })
    )
    const foreign = renderHook(() => useTaskFilters(SPRINT_SCOPE))
    expect(foreign.result.current.filters).toEqual({ status: ['TODO'] })
  })

  it('reloads when the scope key changes', () => {
    localStorage.setItem(
      `${MY_TASKS_SCOPE}:filters`,
      JSON.stringify({ status: ['DONE'] })
    )
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useTaskFilters(scope),
      { initialProps: { scope: SPRINT_SCOPE } }
    )
    expect(result.current.filters).toEqual({})

    rerender({ scope: MY_TASKS_SCOPE })
    expect(result.current.filters).toEqual({ status: ['DONE'] })
  })
})
