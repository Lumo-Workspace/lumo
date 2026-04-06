'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { useIntl } from 'react-intl'
import { getBaseExtensions } from '@/lib/editor/extensions'
import {
  SlashCommandExtension,
  buildSlashCommandSuggestion,
  type SlashCommandPopupState,
} from '@/lib/editor/slash-command'
import {
  SlashCommandList,
  type SlashCommandListRef,
} from '@/lib/editor/slash-command-list'

interface DocumentEditorProps {
  content: string | null
  onUpdate: (content: string) => void
  placeholder?: string
}

export function DocumentEditor({
  content,
  onUpdate,
  placeholder,
}: DocumentEditorProps) {
  const intl = useIntl()
  const [slashPopup, setSlashPopup] = useState<SlashCommandPopupState | null>(
    null
  )
  const slashListRef = useRef<SlashCommandListRef | null>(null)

  const editor = useEditor({
    extensions: [
      ...getBaseExtensions(),
      Placeholder.configure({
        placeholder:
          placeholder ??
          intl.formatMessage({ id: 'documentEditor.slashPlaceholder' }),
      }),
      SlashCommandExtension.configure({
        suggestion: buildSlashCommandSuggestion(
          state => setSlashPopup(state),
          state => setSlashPopup(state),
          () => setSlashPopup(null),
          slashListRef
        ),
      }),
    ],
    content: content ? JSON.parse(content) : undefined,
    onUpdate: ({ editor: e }) => {
      onUpdate(JSON.stringify(e.getJSON()))
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[300px]',
      },
    },
  })

  // Update content when prop changes (e.g. switching documents)
  useEffect(() => {
    if (editor && content) {
      const currentContent = JSON.stringify(editor.getJSON())
      if (currentContent !== content) {
        editor.commands.setContent(JSON.parse(content))
      }
    }
  }, [editor, content])

  return (
    <div className='relative'>
      <EditorContent editor={editor} />

      {slashPopup &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: slashPopup.rect.left,
              top: slashPopup.rect.bottom + 4,
              zIndex: 50,
            }}
          >
            <SlashCommandList
              ref={slashListRef}
              items={slashPopup.items}
              command={slashPopup.command}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
