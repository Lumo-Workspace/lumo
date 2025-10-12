'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
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
import { useCallback, useEffect, useState, useRef } from 'react'
import { FloatingMenu } from './floating-menu'
import { TableOfContents } from './table-of-contents'
import { TableOfContents as TableOfContentsExtension } from '../extensions/table-of-contents'

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
  placeholder = '开始输入内容...',
  editable = true,
  className = '',
}: HeadlessTipTapEditorProps) {
  // 悬浮菜单状态
  const [showFloatingMenu, setShowFloatingMenu] = useState(false)
  const [floatingMenuPosition, setFloatingMenuPosition] = useState({
    x: 0,
    y: 0,
  })
  const [selectedText, setSelectedText] = useState('')

  const editorRef = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
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
      }),
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
      }),
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
          class: 'not-prose',
        },
      }),
      TaskItem.configure({
        HTMLAttributes: {
          class: 'flex items-start space-x-2',
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

  // 处理文本选择和悬浮菜单显示 - 使用与基础测试相同的成功方法
  const handleTextSelection = useCallback(() => {
    if (typeof window === 'undefined') {
      setShowFloatingMenu(false)
      return
    }

    const selection = window.getSelection()
    if (!selection) {
      setShowFloatingMenu(false)
      return
    }

    const selectedText = selection.toString().trim()
    setSelectedText(selectedText)

    // 简化逻辑，只要有选中文本就显示菜单
    if (selectedText && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      // 将菜单显示在选中文字上方，避免遮挡
      setFloatingMenuPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 50, // 增加距离，避免遮挡选中文字
      })
      setShowFloatingMenu(true)
    } else {
      setShowFloatingMenu(false)
    }
  }, [])

  // 添加文本选择事件监听
  useEffect(() => {
    // 全局选择变化监听
    document.addEventListener('selectionchange', handleTextSelection)

    // 点击其他地方隐藏悬浮菜单
    const handleClickOutside = (e: MouseEvent) => {
      const editorElement = editorRef.current
      const target = e.target as Node

      // 检查点击是否在编辑器内部
      if (!editorElement || !editorElement.contains(target)) {
        // 检查点击是否在悬浮菜单上（包括下拉菜单）
        const floatingMenu = document.querySelector('.floating-menu')
        const dropdownContent = document.querySelector(
          '[data-radix-popper-content-wrapper]'
        )
        const dropdownPortal = document.querySelector('[data-radix-portal]')

        const isClickOnFloatingMenu =
          floatingMenu && floatingMenu.contains(target)
        const isClickOnDropdown =
          (dropdownContent && dropdownContent.contains(target)) ||
          (dropdownPortal && dropdownPortal.contains(target))

        if (!isClickOnFloatingMenu && !isClickOnDropdown) {
          setShowFloatingMenu(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('selectionchange', handleTextSelection)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [handleTextSelection])

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
        <div ref={editorRef} className='w-full h-full'>
          <EditorContent
            editor={editor}
            className='min-h-[200px] w-full h-full'
          />
        </div>
      </div>

      {/* 完整悬浮菜单 */}
      {showFloatingMenu && selectedText && (
        <FloatingMenu position={floatingMenuPosition} editor={editor} />
      )}
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
