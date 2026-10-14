/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { useVersionDismissal } from '@/app/workspace/[workspaceUrl]/hooks/useVersionDismissal'

const KEY = 'test.dismissal'

beforeEach(() => window.localStorage.clear())

describe('useVersionDismissal (LUM-1136)', () => {
  it('starts not dismissed and remembers a dismissal for that version', () => {
    const { result } = renderHook(() => useVersionDismissal(KEY, '1.121.0'))
    expect(result.current.dismissed).toBe(false)
    act(() => result.current.dismiss())
    expect(result.current.dismissed).toBe(true)
    expect(window.localStorage.getItem(KEY)).toBe('1.121.0')
  })

  it('reads a stored dismissal on mount', () => {
    window.localStorage.setItem(KEY, '1.121.0')
    const { result } = renderHook(() => useVersionDismissal(KEY, '1.121.0'))
    expect(result.current.dismissed).toBe(true)
  })

  it('a newer version brings the notice back', () => {
    window.localStorage.setItem(KEY, '1.120.0')
    const { result } = renderHook(() => useVersionDismissal(KEY, '1.121.0'))
    expect(result.current.dismissed).toBe(false)
  })

  it('unknown latest version → dismissing still works and is remembered', () => {
    const { result } = renderHook(() => useVersionDismissal(KEY, null))
    expect(result.current.dismissed).toBe(false)
    act(() => result.current.dismiss())
    expect(result.current.dismissed).toBe(true)
    expect(window.localStorage.getItem(KEY)).toBe('')
  })

  it('reads as dismissed until storage has been read (no flash on load)', () => {
    window.localStorage.setItem(KEY, '1.121.0')
    const seen: boolean[] = []
    renderHook(() => {
      const r = useVersionDismissal(KEY, '1.121.0')
      seen.push(r.dismissed)
      return r
    })
    expect(seen.every(Boolean)).toBe(true)
  })

  it('survives storage that throws', () => {
    const get = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    const set = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked')
      })
    const { result } = renderHook(() => useVersionDismissal(KEY, '1.121.0'))
    act(() => result.current.dismiss())
    expect(result.current.dismissed).toBe(true)
    get.mockRestore()
    set.mockRestore()
  })
})
