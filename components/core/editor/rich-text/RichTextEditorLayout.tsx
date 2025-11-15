'use client'

import type { ReactNode } from 'react'
import { TableOfContents } from '../table-of-contents/TableOfContents'
import { BubbleMenuComponent } from '../floating-menu/BubbleMenuComponent'
import type { Editor } from '@tiptap/react'
import { RichTextEditorContent } from './RichTextEditorContent'

interface RichTextEditorLayoutProps {
  editor: Editor | null
  editorRef?: React.RefObject<HTMLDivElement | null>
  children?: ReactNode
}

/**
 * RichTextEditorLayout - Layout component for RichTextEditor
 * Separates layout concerns from editor logic
 */
export function RichTextEditorLayout({
  editor,
  editorRef,
  children,
}: RichTextEditorLayoutProps) {
  return (
    <div className='bg-white relative h-full w-full flex'>
      {/* 左侧目录 */}
      <div className='w-64 p-4 overflow-y-auto'>
        <TableOfContents />
      </div>

      {/* 右侧编辑器内容区域 */}
      <div className='flex-1 p-4 h-full'>
        <div ref={editorRef || undefined} className='w-full h-full relative'>
          <RichTextEditorContent editor={editor} />

          {/* BubbleMenu 浮动菜单 */}
          {editor && <BubbleMenuComponent editor={editor} />}

          {children}
        </div>
      </div>
    </div>
  )
}
