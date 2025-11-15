'use client'

import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'

interface RichTextEditorContentProps {
  editor: Editor | null
  className?: string
}

/**
 * RichTextEditorContent - Pure presentation component for editor content
 * Separated for better component composition following React 19 patterns
 */
export function RichTextEditorContent({
  editor,
  className = '',
}: RichTextEditorContentProps) {
  if (!editor) {
    return null
  }

  return (
    <EditorContent
      editor={editor}
      className={`min-h-[200px] w-full h-full ${className}`}
    />
  )
}
