import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import {
  useTocSync,
  type TocItem,
} from '@/app/workspace/[workspaceUrl]/hooks/useTocSync'

/** Minimal editor stub exposing only tableOfContents storage. */
function editorWithToc(content: unknown) {
  return {
    storage: { tableOfContents: { content } },
  } as unknown as import('@tiptap/core').Editor
}

function renderToc(editor: unknown, onTocUpdate: (items: TocItem[]) => void) {
  return renderHook(() => {
    const onTocUpdateRef = useRef(onTocUpdate)
    onTocUpdateRef.current = onTocUpdate
    const tocScrollRootRef = useRef<HTMLElement | null>(null)
    const emitTocRef = useRef<(data?: TableOfContentData) => void>(() => {})
    useTocSync({
      editor: editor as import('@tiptap/core').Editor | null,
      tocEnabled: true,
      tocScrollRoot: null,
      onTocUpdate,
      onTocUpdateRef,
      tocScrollRootRef,
      emitTocRef,
    })
    return { emitTocRef }
  })
}

it('emits [] when the TOC storage is empty', () => {
  const onTocUpdate = jest.fn()
  renderToc(editorWithToc([]), onTocUpdate)
  expect(onTocUpdate).toHaveBeenLastCalledWith([])
})

it('emits the items it is handed even when storage.content is still empty', () => {
  // Reopen bug: the Tiptap TableOfContents extension fires its
  // `onUpdate` callback BEFORE it assigns `storage.content`, so an emit that
  // re-reads storage sees the stale (empty) value. For a doc reopened with
  // headings that already carry `data-toc-id`, onCreate's id-assignment pass is
  // a no-op (no doc change → no follow-up setTocData), so the only emits that
  // fire all read empty storage and the outline stays blank until a scroll
  // happens to read the by-then-populated storage. The fix: emit must use the
  // payload the extension passes it, not re-read storage.
  const onTocUpdate = jest.fn()
  const { result } = renderToc(editorWithToc([]), onTocUpdate) // storage empty
  onTocUpdate.mockClear()

  act(() => {
    result.current.emitTocRef.current([
      {
        id: 'a',
        level: 1,
        textContent: 'Intro',
        itemIndex: 1,
        isActive: false,
        isScrolledOver: false,
      },
    ] as unknown as TableOfContentData)
  })

  const calls = onTocUpdate.mock.calls
  const items = calls[calls.length - 1]?.[0] as TocItem[]
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ id: 'a', textContent: 'Intro' })
})

it('marks the first heading active when there is no scroll root', () => {
  const onTocUpdate = jest.fn()
  renderToc(
    editorWithToc([
      { id: 'a', level: 1, textContent: 'Intro', itemIndex: 1 },
      { id: 'b', level: 2, textContent: 'Details', itemIndex: 2 },
    ]),
    onTocUpdate
  )
  const calls = onTocUpdate.mock.calls
  const items = calls[calls.length - 1]?.[0] as TocItem[]
  expect(items).toHaveLength(2)
  expect(items[0]).toMatchObject({ id: 'a', isActive: true })
  expect(items[1]).toMatchObject({ id: 'b', isActive: false })
})
