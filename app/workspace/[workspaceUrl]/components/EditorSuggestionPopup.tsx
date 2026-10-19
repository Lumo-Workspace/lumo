'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { computePopupPosition } from '@/lib/editor/popup-position'
import { cn } from '@/lib/utils'

interface EditorSuggestionPopupProps {
  /** Caret/anchor rect in viewport coordinates (from suggestion clientRect). */
  anchorRect: { top: number; bottom: number; left: number }
  /** Box chrome applied to the positioned container (border, bg, width…). */
  className?: string
  children: React.ReactNode
}

/**
 * Shared portal wrapper for the editor's mention/slash suggestion popups.
 *
 * Renders a `position: fixed` portal on `document.body`, measures itself, and
 * positions via {@link computePopupPosition} so the popup flips above the caret
 * (and clamps to the viewport) instead of being clipped near a screen edge.
 *
 * The measurement runs in a layout effect (before paint), so the corrected
 * position is the only one the browser ever paints — no visible jump from the
 * initial below-the-caret guess. Re-running on every render also keeps the
 * popup aligned as the caret moves or the filtered item list changes height.
 */
export function EditorSuggestionPopup({
  anchorRect,
  className,
  children,
}: EditorSuggestionPopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Initial guess: below the caret. Corrected in the layout effect before paint.
  const [pos, setPos] = useState(() => ({
    top: anchorRect.bottom + 6,
    left: anchorRect.left,
  }))

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = computePopupPosition({
      anchorRect,
      popupSize: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    })
    // Guard against the no-deps effect looping: only commit a real change.
    setPos(prev =>
      prev.top === next.top && prev.left === next.left
        ? prev
        : { top: next.top, left: next.left }
    )
  })

  return createPortal(
    <div
      ref={ref}
      // Portaled to <body>: inside a modal Dialog, body gets
      // `pointer-events: none`, so opt back in; the data attribute lets the
      // dialog treat clicks / Esc here as the editor's, not as a dismissal.
      data-editor-suggestion-popup=''
      className={cn('pointer-events-auto fixed z-dropdown', className)}
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>,
    document.body
  )
}
