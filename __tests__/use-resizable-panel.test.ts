/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useResizablePanel } from '../app/workspace/[workspaceUrl]/hooks/useResizablePanel'

describe('useResizablePanel', () => {
  it('returns default width of 384', () => {
    const { result } = renderHook(() => useResizablePanel())
    expect(result.current.width).toBe(384)
  })

  it('accepts a custom initial width', () => {
    const { result } = renderHook(() =>
      useResizablePanel({ initialWidth: 500 })
    )
    expect(result.current.width).toBe(500)
  })

  it('provides a handleDividerMouseDown function', () => {
    const { result } = renderHook(() => useResizablePanel())
    expect(typeof result.current.handleDividerMouseDown).toBe('function')
  })

  it('clamps width to minWidth on mousemove', () => {
    const { result } = renderHook(() =>
      useResizablePanel({ initialWidth: 300, minWidth: 200, maxWidth: 600 })
    )

    // Simulate mousedown
    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 300,
      } as React.MouseEvent)
    })

    // Simulate mousemove that would drag far left (below min)
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 50 })
      document.dispatchEvent(event)
    })

    expect(result.current.width).toBe(200) // clamped to minWidth

    // Clean up: mouseup
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('clamps width to maxWidth on mousemove', () => {
    const { result } = renderHook(() =>
      useResizablePanel({ initialWidth: 300, minWidth: 200, maxWidth: 600 })
    )

    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 300,
      } as React.MouseEvent)
    })

    // Simulate mousemove that would drag far right (above max)
    act(() => {
      const event = new MouseEvent('mousemove', { clientX: 1000 })
      document.dispatchEvent(event)
    })

    expect(result.current.width).toBe(600) // clamped to maxWidth

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('resets cursor style on mouseup', () => {
    const { result } = renderHook(() => useResizablePanel())

    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 300,
      } as React.MouseEvent)
    })

    expect(document.body.style.cursor).toBe('col-resize')

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(document.body.style.cursor).toBe('')
  })
})
