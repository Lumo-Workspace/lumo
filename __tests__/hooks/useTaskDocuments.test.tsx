jest.mock('@/lib/api-client/base', () => ({
  apiFetch: jest.fn(),
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { useTaskDocuments } from '@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments'
import { apiFetch } from '@/lib/api-client/base'

const mockApiFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('useTaskDocuments', () => {
  it('fetches documents on mount when enabled', async () => {
    mockApiFetch.mockResolvedValue({
      documents: [
        {
          id: 'd1',
          title: 'Doc',
          emoji: null,
          updatedAt: '2026-05-19T00:00:00Z',
        },
      ],
    })

    const { result } = renderHook(() => useTaskDocuments('tsk_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockApiFetch).toHaveBeenCalledWith('/api/tasks/tsk_1/documents')
    expect(result.current.documents).toHaveLength(1)
    expect(result.current.documents[0].title).toBe('Doc')
  })

  it('skips fetch when enabled=false', async () => {
    renderHook(() => useTaskDocuments('tsk_1', false))
    await new Promise(r => setTimeout(r, 0))
    expect(mockApiFetch).not.toHaveBeenCalled()
  })

  it('captures error message on failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTaskDocuments('tsk_1'))
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.documents).toEqual([])
  })

  it('refresh re-fetches on demand', async () => {
    mockApiFetch.mockResolvedValue({ documents: [] })
    const { result } = renderHook(() => useTaskDocuments('tsk_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockApiFetch.mockClear()
    await act(async () => {
      await result.current.refresh()
    })
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })
})
