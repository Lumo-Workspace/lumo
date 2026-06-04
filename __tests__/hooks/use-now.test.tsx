import { act, renderHook } from '@testing-library/react'
import { useNow } from '@/hooks/use-now'

describe('useNow', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    // Drop pending timers without firing them — running the interval here would
    // call setNow outside act() and emit a spurious warning.
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('returns the current time once mounted', () => {
    const t0 = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(t0)

    const { result } = renderHook(() => useNow())

    expect(result.current).toBe(t0)
  })

  it('refreshes on each interval tick', () => {
    let clock = 1_000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)

    const { result } = renderHook(() => useNow(60_000))
    expect(result.current).toBe(1_000)

    clock = 61_000
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe(61_000)

    clock = 121_000
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe(121_000)
  })

  it('honors a custom interval', () => {
    let clock = 0
    jest.spyOn(Date, 'now').mockImplementation(() => clock)

    const { result } = renderHook(() => useNow(1_000))
    expect(result.current).toBe(0)

    // Half an interval — no update yet.
    clock = 500
    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(result.current).toBe(0)

    // Crossing the interval boundary — updates.
    clock = 1_000
    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(result.current).toBe(1_000)
  })

  it('stops ticking after unmount', () => {
    let clock = 5
    jest.spyOn(Date, 'now').mockImplementation(() => clock)

    const { result, unmount } = renderHook(() => useNow(1_000))
    expect(result.current).toBe(5)

    unmount()
    clock = 9_999
    act(() => {
      jest.advanceTimersByTime(10_000)
    })
    // Frozen at the last value seen before unmount — no post-unmount updates.
    expect(result.current).toBe(5)
  })
})
