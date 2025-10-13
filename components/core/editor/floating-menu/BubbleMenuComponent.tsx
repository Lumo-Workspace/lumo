'use client'

import React from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'

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
      <div className='flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2'>
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            editor.isActive('bold')
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          type='button'
        >
          粗体
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            editor.isActive('italic')
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          type='button'
        >
          斜体
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            editor.isActive('strike')
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          type='button'
        >
          删除线
        </button>
        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            editor.isActive('code')
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          type='button'
        >
          代码
        </button>
      </div>
    </BubbleMenu>
  )
}
