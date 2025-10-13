'use client'

import React from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import './BubbleMenuComponent.scss'

interface BubbleMenuComponentProps {
  editor: Editor
}

export function BubbleMenuComponent({ editor }: BubbleMenuComponentProps) {
  if (!editor) {
    return null
  }

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ state }) => {
        // 只对有文本选择时显示菜单
        const { from: selectionFrom, to: selectionTo } = state.selection

        if (selectionFrom === selectionTo) {
          return false
        }

        // 检查是否在文档标题（第一个标题）中
        const firstChild = state.doc.firstChild

        // 如果选择在第一个标题中，不显示悬浮菜单
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
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleBold().run()}
        >
          粗体
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleItalic().run()}
        >
          斜体
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={editor.isActive('strike') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleStrike().run()}
        >
          删除线
        </button>
        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={editor.isActive('code') ? 'is-active' : ''}
          type='button'
          disabled={!editor.can().chain().focus().toggleCode().run()}
        >
          代码
        </button>
      </div>
    </BubbleMenu>
  )
}
