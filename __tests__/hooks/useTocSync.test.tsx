import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useTocSync, type TocItem } from '@/app/workspace/[workspaceUrl]/hooks/useTocSync'

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
    const emitTocRef = useRef<() => void>(() => {})
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
