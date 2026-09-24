const mockSignOut = jest.fn()
jest.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ signOut: mockSignOut }),
}))
jest.mock('@/lib/api-client', () => ({
  workspacesClient: { leaveWorkspace: jest.fn() },
}))
jest.mock('@/app/workspace/[workspaceUrl]/cache', () => ({
  clearCache: jest.fn(),
}))

import { act, renderHook } from '@testing-library/react'
import { useLeaveWorkspace } from '@/app/workspace/[workspaceUrl]/hooks/useLeaveWorkspace'
import { workspacesClient } from '@/lib/api-client'
import { clearCache } from '@/app/workspace/[workspaceUrl]/cache'

const mockLeave = workspacesClient.leaveWorkspace as jest.Mock
const mockClearCache = clearCache as jest.Mock

describe('useLeaveWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('signs out and redirects to the homepage after leaving', async () => {
    mockLeave.mockResolvedValue(undefined)
    mockSignOut.mockResolvedValue(undefined)
    const { result } = renderHook(() => useLeaveWorkspace())

    await act(async () => {
      await result.current.leave()
    })

    expect(mockLeave).toHaveBeenCalledTimes(1)
    expect(mockClearCache).toHaveBeenCalledTimes(1)
    expect(mockSignOut).toHaveBeenCalledWith({ redirectUrl: '/' })
    expect(mockLeave.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignOut.mock.invocationCallOrder[0] as number
    )
  })

  it('does not sign out when leaving fails', async () => {
    mockLeave.mockRejectedValue(new Error('last admin'))
    const { result } = renderHook(() => useLeaveWorkspace())

    let caught: unknown
    await act(async () => {
      try {
        await result.current.leave()
      } catch (err) {
        caught = err
      }
    })

    expect((caught as Error).message).toBe('last admin')
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockClearCache).not.toHaveBeenCalled()
    expect(result.current.leaving).toBe(false)
  })
})
