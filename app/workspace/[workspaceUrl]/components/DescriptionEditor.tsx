'use client'

import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'

interface DescriptionEditorProps {
  value: string | null
  onCommit: (html: string | null) => void
  onChange?: (html: string | null) => void
  placeholder?: string
}

export function DescriptionEditor({
  value,
  onCommit,
  onChange,
  placeholder = 'Add a description…',
}: DescriptionEditorProps) {
  const isFocusedRef = useRef(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[80px]',
      },
    },
    onFocus: () => {
      isFocusedRef.current = true
    },
    onBlur: ({ editor }) => {
      isFocusedRef.current = false
      const html = editor.isEmpty ? null : editor.getHTML()
      onCommit(html)
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.isEmpty ? null : editor.getHTML())
    },
  })

  // Sync external value changes (e.g. background fetch) without overwriting
  // what the user is actively typing
  useEffect(() => {
    if (!editor || isFocusedRef.current) return
    const incoming = value || ''
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
  }, [value, editor])

  // Destroy editor on unmount
  useEffect(
    () => () => {
      editor?.destroy()
    },
    [editor]
  )

  return <EditorContent editor={editor} />
}
