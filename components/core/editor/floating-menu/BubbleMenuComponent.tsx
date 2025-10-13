'use client'

import React, { useCallback } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import {
  Bold,
  Strikethrough,
  Italic,
  Underline,
  Link,
  Code,
} from 'lucide-react'
import './BubbleMenuComponent.scss'

interface BubbleMenuComponentProps {
  editor: Editor
}

export function BubbleMenuComponent({ editor }: BubbleMenuComponentProps) {
  const setLink = useCallback(() => {
    if (!editor) return

    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    // cancelled
    if (url === null) {
      return
    }

    // empty - unset link
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    // update link
    try {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url })
        .run()
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Invalid URL format'
      alert(errorMessage)
    }
  }, [editor])

  if (!editor) {
    return null
  }

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ state }) => {
        // Only show menu when text is selected
        const { from: selectionFrom, to: selectionTo } = state.selection

        if (selectionFrom === selectionTo) {
          return false
        }

        // Check if selection is in document title (first heading)
        const firstChild = state.doc.firstChild

        // Hide menu if selection is in the first heading
        if (firstChild && firstChild.type.name === 'heading') {
          const titleStart = 0
          const titleEnd = firstChild.nodeSize - 1

          if (selectionFrom >= titleStart && selectionTo <= titleEnd) {
            return false
          }
        }

        return true
      }}
      options={{ placement: 'bottom', offset: 8, flip: true }}
    >
      <div className='bubble-menu'>
        {/* 1. Bold */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleBold().run()}
          title='Bold'
        >
          <Bold size={16} />
        </button>

        {/* 2. Strikethrough */}
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={editor.isActive('strike') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          title='Strikethrough'
        >
          <Strikethrough size={16} />
        </button>

        {/* 3. Italic */}
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          title='Italic'
        >
          <Italic size={16} />
        </button>

        {/* 4. Underline */}
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={editor.isActive('underline') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleUnderline().run()}
          title='Underline'
        >
          <Underline size={16} />
        </button>

        {/* 5. Link */}
        <button
          onClick={setLink}
          className={editor.isActive('link') ? 'is-active' : ''}
          type='button'
          disabled={
            !editor
              .can()
              .chain()
              .focus()
              .setLink({ href: 'https://example.com' })
              .run()
          }
          title={editor.isActive('link') ? 'Edit link' : 'Add link'}
        >
          <Link size={16} />
        </button>

        {/* 6. Code */}
        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={editor.isActive('code') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleCode().run()}
          title='Code'
        >
          <Code size={16} />
        </button>
      </div>
    </BubbleMenu>
  )
}
