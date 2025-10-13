'use client'

import './RichTextEditor.scss'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CustomDocument } from '../tiptap/extensions/custom-document'
import { CustomPlaceholder } from '../tiptap/extensions/custom-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import { TextStyle, TextStyleKit } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { useEffect, useRef } from 'react'
import { BubbleMenuComponent } from '../floating-menu/BubbleMenuComponent'
import { TableOfContents } from '../table-of-contents/TableOfContents'
import { TableOfContents as TableOfContentsExtension } from '../../../../extensions/table-of-contents'

interface HeadlessTipTapEditorProps {
  content?: string
  onUpdate?: (_content: string) => void
  placeholder?: string
  editable?: boolean
  className?: string
}

export default function HeadlessTipTapEditor({
  content = '',
  onUpdate,
  editable = true,
  className = '',
}: HeadlessTipTapEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      CustomDocument, // 使用自定义文档扩展，确保始终有标题
      TextStyleKit,
      StarterKit.configure({
        // 配置 StarterKit 中的扩展
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        bulletList: {
          keepMarks: true,
          keepAttributes: false,
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
        },
        code: {
          HTMLAttributes: {
            class: 'bg-gray-100 px-1 py-0.5 rounded text-sm font-mono',
          },
        },
        codeBlock: {
          HTMLAttributes: {
            class: 'bg-gray-100 p-4 rounded-lg font-mono text-sm',
          },
        },
      }),
      CustomPlaceholder, // 使用自定义占位符扩展
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-500 hover:text-blue-700 underline cursor-pointer',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg',
        },
      }),
      Typography,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Color,
      TextStyle,
      Underline,
      Highlight.configure({
        multicolor: true,
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'task-list',
        },
      }),
      TaskItem.configure({
        HTMLAttributes: {
          class: 'task-item',
        },
        nested: true,
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse border border-gray-300',
        },
      }),
      TableRow.configure({
        HTMLAttributes: {
          class: 'border border-gray-300',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-gray-300 px-4 py-2',
        },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-gray-300 px-4 py-2 bg-gray-50 font-semibold',
        },
      }),
      HorizontalRule.configure({
        HTMLAttributes: {
          class: 'my-8 border-t-2 border-gray-300',
        },
      }),
      TableOfContentsExtension,
    ],
    content,
    editable,
    onUpdate: ({ editor }: { editor: any }) => {
      const html = editor.getHTML()
      onUpdate?.(html)
    },
    editorProps: {
      attributes: {
        class: `prose prose-lg max-w-none focus:outline-none ${className}`,
        style: 'min-height: 200px; padding: 16px; cursor: text;',
      },
    },
  })

  // 当外部内容变化时更新编辑器
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [editor, content])

  // 当可编辑状态变化时更新编辑器
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  // 清理编辑器实例
  useEffect(() => {
    return () => {
      editor?.destroy()
    }
  }, [editor])

  if (!editor) {
    return (
      <div className='flex-1 flex items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4'></div>
          <p className='text-gray-500'>加载编辑器中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className='bg-white relative h-full w-full flex'>
      {/* 左侧目录 */}
      <div className='w-64 p-4 overflow-y-auto'>
        <TableOfContents />
      </div>

      {/* 右侧编辑器内容区域 */}
      <div className='flex-1 p-4 h-full'>
        <div ref={editorRef} className='w-full h-full relative'>
          <EditorContent
            editor={editor}
            className='min-h-[200px] w-full h-full'
          />

          {/* BubbleMenu 浮动菜单 */}
          {editor && <BubbleMenuComponent editor={editor} />}
        </div>
      </div>
    </div>
  )
}

// 导出编辑器方法类型，供父组件使用
export type EditorMethods = {
  focus: () => void
  clearContent: () => void
  insertContent: (_content: string) => void
  getHTML: () => string
  getText: () => string
  getJSON: () => any
  isEmpty: () => boolean
  isActive: (_name: string, _attributes?: Record<string, any>) => boolean
}
