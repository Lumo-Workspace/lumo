'use client'
import { useState } from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useDocExtractContext } from '@/lib/editor/doc-extract-context'

/**
 * Inline extract button rendered inside each unlinked taskItem row.
 *
 * We intentionally do NOT import HoverExtractButton from
 * `app/workspace/.../components/extract/HoverExtractButton` here. That file
 * imports react-intl which ships as ESM-only, breaking jest tests that import
 * `lib/editor/extensions` (which transitively imports this file via
 * task-item-with-link.ts). The i18n label for this button (key
 * `doc.extract.button.hover`) will be wired in Task 15; until then the literal
 * "→ task" text is used directly.
 */
function InlineExtractButton({ onClick }: { onClick: () => Promise<void> }) {
  const [pending, setPending] = useState(false)

  async function go() {
    setPending(true)
    try {
      await onClick()
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type='button'
      onClick={go}
      disabled={pending}
      className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100'
      aria-label='→ task'
    >
      → task
    </button>
  )
}

export function TaskItemNodeView({ node, getPos, editor }: NodeViewProps) {
  const ctx = useDocExtractContext()
  const isLinked = Boolean(node.attrs.taskId)

  return (
    <NodeViewWrapper
      as='li'
      data-type='taskItem'
      data-checked={node.attrs.checked ? 'true' : 'false'}
      data-task-id={node.attrs.taskId ?? undefined}
      data-task-identifier={node.attrs.taskIdentifier ?? undefined}
      className='group flex items-start gap-2'
    >
      {!isLinked && (
        <label contentEditable={false}>
          <input
            type='checkbox'
            checked={Boolean(node.attrs.checked)}
            onChange={e => {
              const pos = typeof getPos === 'function' ? getPos() : null
              if (pos == null) return
              editor.commands.command(({ tr }) => {
                tr.setNodeAttribute(pos, 'checked', e.target.checked)
                return true
              })
            }}
          />
          <span />
        </label>
      )}
      <div className='flex-1'>
        <NodeViewContent />
      </div>
      {!isLinked && ctx?.documentId && (
        <span contentEditable={false}>
          <InlineExtractButton
            onClick={async () => {
              const { extractTasks } =
                await import('@/lib/api-client/documents-extract')
              const content = ctx.stampPendingOnThisNode(getPos as () => number)
              const res = await extractTasks(ctx.documentId, {
                content,
                selector: { type: 'marked' },
              })
              ctx.onApplied(res.updatedContent)
            }}
          />
        </span>
      )}
    </NodeViewWrapper>
  )
}
