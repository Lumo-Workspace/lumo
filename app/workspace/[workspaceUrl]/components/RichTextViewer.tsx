'use client'

import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { getBaseExtensions } from '@/lib/editor/extensions'

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
    extensions: getBaseExtensions(),
    content: value || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
      },
    },
  })

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

  return <EditorContent editor={editor} />
}
