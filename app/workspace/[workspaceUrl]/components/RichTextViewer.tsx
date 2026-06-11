'use client'

import { useEffect, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { getBaseExtensions } from '@/lib/editor/extensions'
import { extractTaskMentionIdentifiers } from '@/lib/editor/extract-task-mention-identifiers'
import { MentionChip } from './MentionChip'
import { MentionStatusProvider } from './MentionStatusProvider'

interface RichTextViewerProps {
  /** HTML content to render. Convert markdown with `markdownToHtml` first. */
  value: string | null
}

/**
 * Read-only sibling of {@link DescriptionEditor}: renders rich-text HTML with
 * the exact same Tiptap extensions and `prose` classes the description editor
 * uses, so a spec artifact renders identically to a task description — just
 * not editable. Editing-only machinery (mentions, slash commands, image
 * upload, bubble menu, blur-commit) is intentionally left out.
 */
export function RichTextViewer({ value }: RichTextViewerProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: getBaseExtensions({ mentionNodeView: MentionChip }),
    content: value || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
      },
    },
  })

  // The task identifiers referenced by `@LUM-N` chips — drives a single
  // batched live-status lookup behind the chips (LUM-411).
  const identifiers = useMemo(
    () => extractTaskMentionIdentifiers(value || ''),
    [value]
  )

  // Re-render when the incoming content changes (e.g. a different artifact).
  useEffect(() => {
    if (!editor) return
    const incoming = value || ''
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
  }, [value, editor])

  // Destroy the editor instance on unmount.
  useEffect(
    () => () => {
      editor?.destroy()
    },
    [editor]
  )

  return (
    <MentionStatusProvider identifiers={identifiers}>
      <EditorContent editor={editor} />
    </MentionStatusProvider>
  )
}
