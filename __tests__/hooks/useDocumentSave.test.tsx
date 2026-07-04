jest.mock('@/lib/api-client', () => ({
  documentsClient: {
    update: jest.fn(),
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { useDocumentSave } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentSave'
import { documentsClient } from '@/lib/api-client'

const mockUpdate = documentsClient.update as jest.Mock

/** A deferred promise so a test can control when an in-flight save resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe('useDocumentSave', () => {
  it('coalesces content then title within the window into ONE merged patch', async () => {
    mockUpdate.mockResolvedValue({ document: {} })
    const applyResult = jest.fn()
    const { result } = renderHook(() =>
      useDocumentSave({ documentId: 'doc_1', applyResult })
    )

    // Edit content, then the title 200ms later — both inside the 1s window.
    act(() => result.current.debouncedSave({ content: '<p>hi</p>' }))
    act(() => jest.advanceTimersByTime(200))
    act(() => result.current.debouncedSave({ title: 'New title' }))

    // Nothing sent yet — still debouncing.
    expect(mockUpdate).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(1000)
    })

    // A single request carrying BOTH fields — the content edit is not dropped.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith('doc_1', {
      content: '<p>hi</p>',
      title: 'New title',
    })
  })

  it('debounces rapid edits to a single trailing request', async () => {
    mockUpdate.mockResolvedValue({ document: {} })
    const { result } = renderHook(() =>
      useDocumentSave({ documentId: 'doc_1', applyResult: jest.fn() })
    )

    act(() => result.current.debouncedSave({ content: 'a' }))
    act(() => jest.advanceTimersByTime(500))
    act(() => result.current.debouncedSave({ content: 'ab' }))
    act(() => jest.advanceTimersByTime(500))
    act(() => result.current.debouncedSave({ content: 'abc' }))
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith('doc_1', { content: 'abc' })
  })

  it('saveNow flushes pending edits immediately alongside its own', async () => {
    mockUpdate.mockResolvedValue({ document: {} })
    const { result } = renderHook(() =>
      useDocumentSave({ documentId: 'doc_1', applyResult: jest.fn() })
    )

    // A pending title edit is queued, then an emoji pick saves immediately.
    act(() => result.current.debouncedSave({ title: 'T' }))
    await act(async () => {
      result.current.saveNow({ emoji: '🚀' })
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith('doc_1', {
      title: 'T',
      emoji: '🚀',
    })

    // The cancelled debounce timer must not fire a second request.
    act(() => jest.advanceTimersByTime(1000))
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale response so it cannot overwrite newer state', async () => {
    const first = deferred<{ document: Partial<{ title: string }> }>()
    const second = deferred<{ document: Partial<{ title: string }> }>()
    mockUpdate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const applyResult = jest.fn()
    const { result } = renderHook(() =>
      useDocumentSave({ documentId: 'doc_1', applyResult })
    )

    // Two saves started back-to-back: seq 1 then seq 2.
    act(() => result.current.saveNow({ title: 'first' }))
    act(() => result.current.saveNow({ title: 'second' }))
    expect(mockUpdate).toHaveBeenCalledTimes(2)

    // The newer (second) request resolves first and applies.
    await act(async () => {
      second.resolve({ document: { title: 'second' } })
    })
    expect(applyResult).toHaveBeenCalledTimes(1)
    expect(applyResult).toHaveBeenCalledWith({ title: 'second' })

    // The older (first) request resolves LAST — it must be discarded.
    await act(async () => {
      first.resolve({ document: { title: 'first' } })
    })
    expect(applyResult).toHaveBeenCalledTimes(1)
    expect(applyResult).not.toHaveBeenCalledWith({ title: 'first' })
  })

  it('transitions saveStatus saving → saved → idle', async () => {
    const d = deferred<{ document: Record<string, never> }>()
    mockUpdate.mockReturnValueOnce(d.promise)
    const { result } = renderHook(() =>
      useDocumentSave({ documentId: 'doc_1', applyResult: jest.fn() })
    )

    act(() => result.current.saveNow({ content: 'x' }))
    expect(result.current.saveStatus).toBe('saving')

    await act(async () => {
      d.resolve({ document: {} })
    })
    expect(result.current.saveStatus).toBe('saved')

    act(() => jest.advanceTimersByTime(2000))
    expect(result.current.saveStatus).toBe('idle')
  })

  it('sets error status when the request rejects', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() =>
      useDocumentSave({ documentId: 'doc_1', applyResult: jest.fn() })
    )

    await act(async () => {
      result.current.saveNow({ content: 'x' })
    })

    await waitFor(() => expect(result.current.saveStatus).toBe('error'))
  })

  it('does not fire a request when there is nothing pending', () => {
    mockUpdate.mockResolvedValue({ document: {} })
    const { result } = renderHook(() =>
      useDocumentSave({ documentId: 'doc_1', applyResult: jest.fn() })
    )

    act(() => result.current.saveNow({}))
    act(() => jest.advanceTimersByTime(1000))

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  // Optimistic create window (LUM-658): a doc created from a template opens
  // the editor on a client-only `temp-<uuid>` id while the real doc is created
  // in the background. A save fired before the swap would PATCH the temp id,
  // which the server 404s → "Error saving". Saves must defer, then replay
  // against the real id once it arrives.
  it('defers saves while the document is an optimistic placeholder', async () => {
    mockUpdate.mockResolvedValue({ document: {} })
    const { result } = renderHook(() =>
      useDocumentSave({
        documentId: 'temp-abc',
        isPending: true,
        applyResult: jest.fn(),
      })
    )

    // Edit during the temp window, then let both the debounce and an immediate
    // flush elapse — nothing may hit the network (the temp id doesn't exist).
    act(() => result.current.debouncedSave({ content: '<p>edit</p>' }))
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    act(() => result.current.saveNow({ title: 'T' }))
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    // And the deferral is silent — never a phantom saving/error state.
    expect(result.current.saveStatus).toBe('idle')
  })

  it('replays deferred edits to the real document id once the placeholder resolves', async () => {
    mockUpdate.mockResolvedValue({ document: {} })
    const { result, rerender } = renderHook(
      (props: { documentId: string; isPending: boolean }) =>
        useDocumentSave({ ...props, applyResult: jest.fn() }),
      { initialProps: { documentId: 'temp-abc', isPending: true } }
    )

    // User edits while still on the temp id — deferred, not sent.
    act(() => result.current.debouncedSave({ content: '<p>edit</p>' }))
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    expect(mockUpdate).not.toHaveBeenCalled()

    // Background create resolves: id swaps to the real slug, isPending clears.
    await act(async () => {
      rerender({ documentId: 'doc_real', isPending: false })
    })

    // The retained edit is replayed as ONE PATCH to the REAL id — never temp.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith('doc_real', {
      content: '<p>edit</p>',
    })
  })
})
