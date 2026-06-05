'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { resolveGutterLayout, type GutterItem } from './comment-gutter-layout'
import { collectOpenCommentAnchors } from './comment-gutter-dom'

const CARD_HEIGHT = 96
const GAP = 8

export interface GutterLayout {
  /** id → top (px). */
  tops: Record<string, number>
  /** Total content height (px) so the gutter container reserves space. */
  height: number
}

/**
 * Measure comment anchors in the editor and resolve their gutter positions.
 * Recomputes on editor scroll, content mutation, comment changes, and resize.
 */
export function useCommentGutterLayout(
  editor: Editor | null,
  rowEl: HTMLElement | null,
  comments: ApiDocumentComment[]
): GutterLayout {
  const [layout, setLayout] = useState<GutterLayout>({ tops: {}, height: 0 })
  const frame = useRef<number | null>(null)

  const recompute = useCallback(() => {
    if (!editor || !rowEl) {
      setLayout({ tops: {}, height: 0 })
      return
    }
    const items: GutterItem[] = collectOpenCommentAnchors(
      editor.view.dom as HTMLElement,
      rowEl,
      comments
    ).map(a => ({ id: a.id, anchorY: a.anchorY, height: CARD_HEIGHT }))
    const tops = resolveGutterLayout(items, GAP)
    let height = 0
    for (const it of items) {
      const top = tops[it.id] ?? 0
      height = Math.max(height, top + it.height)
    }
    setLayout({ tops, height })
  }, [editor, rowEl, comments])

  const schedule = useCallback(() => {
    if (frame.current != null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      recompute()
    })
  }, [recompute])

  // Initial + dependency-driven recompute (synchronous so first paint positions).
  useEffect(() => {
    recompute()
  }, [recompute])

  // Re-measure on scroll/resize/content mutation.
  useEffect(() => {
    if (!editor || !rowEl) return
    const dom = editor.view.dom as HTMLElement
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const mo = new MutationObserver(schedule)
    mo.observe(dom, { childList: true, subtree: true, characterData: true })
    return () => {
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      mo.disconnect()
      if (frame.current != null) cancelAnimationFrame(frame.current)
    }
  }, [editor, rowEl, schedule])

  return layout
}
