import { act, render } from '@testing-library/react'
import { useAutoHideScrollbar } from '@/app/workspace/[workspaceUrl]/hooks/useAutoHideScrollbar'

function Scrollable({ hideDelayMs }: { hideDelayMs?: number }) {
  const ref = useAutoHideScrollbar<HTMLDivElement>(hideDelayMs)
  return (
    <div ref={ref} data-testid='scroller'>
      content
    </div>
  )
}

describe('useAutoHideScrollbar', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('shows the scrollbar while scrolling and hides it after the delay', () => {
    const { getByTestId } = render(<Scrollable hideDelayMs={1000} />)
    const el = getByTestId('scroller')

    expect(el.classList.contains('scrollbar-visible')).toBe(false)

    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    expect(el.classList.contains('scrollbar-visible')).toBe(true)

    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(el.classList.contains('scrollbar-visible')).toBe(false)
  })

  it('resets the hide timer on each scroll event', () => {
    const { getByTestId } = render(<Scrollable hideDelayMs={1000} />)
    const el = getByTestId('scroller')

    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    act(() => {
      jest.advanceTimersByTime(800)
    })
    // still visible — under the delay
    expect(el.classList.contains('scrollbar-visible')).toBe(true)

    // a second scroll restarts the countdown
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    act(() => {
      jest.advanceTimersByTime(800)
    })
    expect(el.classList.contains('scrollbar-visible')).toBe(true)

    act(() => {
      jest.advanceTimersByTime(200)
    })
    expect(el.classList.contains('scrollbar-visible')).toBe(false)
  })
})
