/**
 * LUM-906 PR2 — the Members page's remove action: calls the DELETE endpoint
 * and refreshes the shared members cache; on failure it rethrows and does
 * not refresh.
 */
const mockInvalidate = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => ({ invalidateMembers: mockInvalidate }),
}))
jest.mock('@/lib/api-client', () => ({
  workspacesClient: { removeMember: jest.fn() },
}))

import { act, renderHook } from '@testing-library/react'
import { useRemoveMember } from '@/app/workspace/[workspaceUrl]/hooks/useRemoveMember'
import { workspacesClient } from '@/lib/api-client'

const mockRemove = workspacesClient.removeMember as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('useRemoveMember', () => {
  it('remove member hook calls the API and refreshes the members cache', async () => {
    mockRemove.mockResolvedValue(undefined)
    const { result } = renderHook(() => useRemoveMember())

    await act(async () => {
      await result.current.remove('m-2')
    })

    expect(mockRemove).toHaveBeenCalledWith('m-2')
    expect(mockInvalidate).toHaveBeenCalledTimes(1)
    expect(result.current.removingId).toBeNull()
  })

  it('remove member hook rethrows and does not refresh on failure', async () => {
    mockRemove.mockRejectedValue(new Error('Cannot remove the last admin'))
    const { result } = renderHook(() => useRemoveMember())

    let caught: unknown
    await act(async () => {
      try {
        await result.current.remove('m-2')
      } catch (err) {
        caught = err
      }
    })

    expect((caught as Error).message).toBe('Cannot remove the last admin')
    expect(mockInvalidate).not.toHaveBeenCalled()
    expect(result.current.removingId).toBeNull()
  })
})
