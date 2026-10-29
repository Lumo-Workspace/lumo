jest.mock('@/lib/api-client/task-documents', () => ({
  taskDocumentsClient: {
    list: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { useTaskDocuments } from '@/app/workspace/[workspaceUrl]/hooks/useTaskDocuments'
import { taskDocumentsClient } from '@/lib/api-client/task-documents'
import { createQueryWrapper } from '../helpers/query-client'

const mockList = taskDocumentsClient.list as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('useTaskDocuments', () => {
  it('fetches documents on mount when enabled', async () => {
    mockList.mockResolvedValue({
      documents: [
        {
          id: 'd1',
          title: 'Doc',
          emoji: null,
          updatedAt: '2026-05-19T00:00:00Z',
        },
      ],
    })

    const { result } = renderHook(() => useTaskDocuments('tsk_1'), {
      wrapper: createQueryWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockList).toHaveBeenCalledWith('tsk_1')
    expect(result.current.documents).toHaveLength(1)
    expect(result.current.documents[0]?.title).toBe('Doc')
  })

  it('skips fetch when enabled=false', async () => {
    renderHook(() => useTaskDocuments('tsk_1', false), {
      wrapper: createQueryWrapper(),
    })
    await new Promise(r => setTimeout(r, 0))
    expect(mockList).not.toHaveBeenCalled()
  })

  it('captures error message on failure', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTaskDocuments('tsk_1'), {
      wrapper: createQueryWrapper(),
    })
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.documents).toEqual([])
  })

  it('refresh re-fetches on demand', async () => {
    mockList.mockResolvedValue({ documents: [] })
    const { result } = renderHook(() => useTaskDocuments('tsk_1'), {
      wrapper: createQueryWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockList.mockClear()
    await act(async () => {
      await result.current.refresh()
    })
    expect(mockList).toHaveBeenCalledTimes(1)
  })
})
