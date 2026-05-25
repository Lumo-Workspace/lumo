'use client'
import { createContext, useContext, useMemo, ReactNode } from 'react'
import type { Editor } from '@tiptap/core'

export interface DocExtractCtx {
  documentId: string
  editor: Editor
  onApplied: (newContent: string) => void
  onError: (err: Error) => void
  stampPendingOnThisNode: (getPos: () => number) => string
}

const Ctx = createContext<DocExtractCtx | null>(null)

export function DocExtractProvider({
  value,
  children,
}: {
  value: DocExtractCtx
  children: ReactNode
}) {
  const memo = useMemo(() => value, [value])
  return <Ctx.Provider value={memo}>{children}</Ctx.Provider>
}

export function useDocExtractContext() {
  return useContext(Ctx)
}

/**
 * Build the `stampPendingOnThisNode` callback that the context expects.
 * Lives separately so the doc page can wire it without inlining the
 * ProseMirror-y bits.
 *
 * The callback:
 * 1. Takes a `getPos()` callback returning a ProseMirror position
 * 2. Sets `extractPending: true` on the taskItem node at that position
 * 3. Calls `editor.getHTML()` to serialize the doc (now containing
 *    `data-extract-pending="true"` on the target node)
 * 4. Immediately resets `extractPending: null` on that same node
 * 5. Returns the serialized HTML
 */
export function buildStampPending(editor: Editor) {
  return (getPos: () => number): string => {
    const pos = getPos()
    // Stamp data-extract-pending="true" via ProseMirror transaction
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(pos, 'extractPending', true)
      return true
    })
    const html = editor.getHTML()
    // Revert immediately
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(pos, 'extractPending', null)
      return true
    })
    return html
  }
}
