'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface UseResizablePanelOptions {
  /** Initial width in pixels */
  initialWidth?: number
  /** Minimum width in pixels */
  minWidth?: number
  /** Maximum width in pixels */
  maxWidth?: number
}

interface UseResizablePanelReturn {
  /** Current width of the left panel in pixels */
  width: number
  /** onMouseDown handler for the divider element */
  handleDividerMouseDown: (e: React.MouseEvent) => void
}

export function useResizablePanel(
  options: UseResizablePanelOptions = {}
): UseResizablePanelReturn {
  const { initialWidth = 384, minWidth = 220, maxWidth = 600 } = options

  const [width, setWidth] = useState(initialWidth)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true
      dragStartX.current = e.clientX
      dragStartWidth.current = width
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width]
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - dragStartX.current
      const next = Math.max(
        minWidth,
        Math.min(maxWidth, dragStartWidth.current + delta)
      )
      setWidth(next)
    }
    const onMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [minWidth, maxWidth])

  return { width, handleDividerMouseDown }
}
