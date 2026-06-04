import { useEffect, type MutableRefObject } from 'react'
import type { Editor } from '@tiptap/core'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { computeActiveTocIndex } from '@/lib/editor/toc-active'

export type TocItem = {
  id: string
  level: number
  textContent: string
  isActive: boolean
  itemIndex: number
}

interface UseTocSyncArgs {
  editor: Editor | null
  tocEnabled: boolean
  tocScrollRoot: HTMLElement | null | undefined
  onTocUpdate: ((items: TocItem[]) => void) | undefined
  onTocUpdateRef: MutableRefObject<((items: TocItem[]) => void) | undefined>
  tocScrollRootRef: MutableRefObject<HTMLElement | null | undefined>
  emitTocRef: MutableRefObject<() => void>
}

export function useTocSync({
  editor,
  tocEnabled,
  tocScrollRoot,
  onTocUpdate,
  onTocUpdateRef,
  tocScrollRootRef,
  emitTocRef,
}: UseTocSyncArgs): void {
  // Mirror effects (moved out of the component):
  useEffect(() => {
    onTocUpdateRef.current = onTocUpdate
  }, [onTocUpdate, onTocUpdateRef])
  useEffect(() => {
    tocScrollRootRef.current = tocScrollRoot
  }, [tocScrollRoot, tocScrollRootRef])

  useEffect(() => {
    if (!tocEnabled || !editor) return

    const ACTIVE_OFFSET = 80 // px below container top that still counts as "at the top"

    // Cache heading elements by toc-id so scroll doesn't re-run an O(n)
    // querySelector sweep every frame. A cached node is reused until it leaves
    // the DOM (el.isConnected === false) — which is exactly when ProseMirror
    // has replaced the heading node mid-edit, so the next lookup re-queries.
    // offsetTop is read live off the cached node (cheap; no layout thrash
    // during a pure scroll), only the tree traversal is what we elide.
    const elCache = new Map<string, HTMLElement>()
    const resolveOffsetTop = (root: HTMLElement, id: string): number | null => {
      const cached = elCache.get(id)
      if (cached && cached.isConnected) return cached.offsetTop
      const el = root.querySelector(
        `[data-toc-id="${id}"]`
      ) as HTMLElement | null
      if (!el) {
        elCache.delete(id)
        return null
      }
      elCache.set(id, el)
      return el.offsetTop
    }

    const emit = () => {
      const tocStorage = editor.storage.tableOfContents as
        | { content?: TableOfContentData }
        | undefined
      const items = tocStorage?.content ?? []
      if (!items.length) {
        onTocUpdateRef.current?.([])
        return
      }

      // With no scroll root we can't measure geometry; highlight the first
      // heading (matches the old activeIdx === -1 → 0 fallback). Otherwise hand
      // the cached offsetTops + scroll metrics to the pure resolver, which
      // keeps the "at bottom → last heading" and "nothing crossed → first
      // heading" semantics. See lib/editor/toc-active.ts.
      const root = tocScrollRootRef.current
      const activeIdx = root
        ? computeActiveTocIndex(
            items.map(item => ({
              offsetTop: resolveOffsetTop(root, item.id),
            })),
            {
              scrollTop: root.scrollTop,
              clientHeight: root.clientHeight,
              scrollHeight: root.scrollHeight,
            },
            ACTIVE_OFFSET
          )
        : 0

      onTocUpdateRef.current?.(
        items.map((item, i) => ({
          id: item.id,
          level: item.level,
          textContent: item.textContent,
          isActive: i === activeIdx,
          itemIndex: item.itemIndex,
        }))
      )
    }

    emitTocRef.current = emit

    // The extension auto-attaches its own scrollHandler to window during
    // onCreate. Detach it so it doesn't push stale `isActive` values that
    // race with ours.
    const tocStorage = editor.storage.tableOfContents as
      | { scrollHandler?: () => void }
      | undefined
    if (typeof tocStorage?.scrollHandler === 'function') {
      window.removeEventListener('scroll', tocStorage.scrollHandler)
    }

    if (!tocScrollRoot) {
      emit()
      return
    }

    // Coalesce bursts of scroll events into one recompute per frame. Scroll
    // fires far faster than the display refreshes, and emit() reads layout, so
    // throttling to rAF keeps long-document scrolling smooth.
    let rafId: number | null = null
    const onScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        emit()
      })
    }

    tocScrollRoot.addEventListener('scroll', onScroll, { passive: true })
    emit()

    return () => {
      tocScrollRoot.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [
    editor,
    tocEnabled,
    tocScrollRoot,
    onTocUpdateRef,
    tocScrollRootRef,
    emitTocRef,
  ])
}
