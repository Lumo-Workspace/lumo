'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import TextAlign from '@tiptap/extension-text-align'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
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

  console.log('HeadlessTipTapEditor rendered')
  console.log('Current state:', {
    showFloatingMenu,
    selectedText,
    floatingMenuPosition,
  })
  const editorRef = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
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
    console.log('=== handleTextSelection called ===')
    if (typeof window === 'undefined') {
      console.log('Not in browser environment')
      setShowFloatingMenu(false)
      return
    }

    const selection = window.getSelection()
    console.log('Selection object:', selection)
    if (!selection) {
      console.log('No selection object')
      setShowFloatingMenu(false)
      return
    }

    const selectedText = selection.toString().trim()
    console.log('Selected text:', `"${selectedText}"`)
    setSelectedText(selectedText)

    // 简化逻辑，只要有选中文本就显示菜单
    if (selectedText && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      console.log(
        'Setting menu position:',
        rect.left + rect.width / 2,
        rect.top - 50
      )

      // 将菜单显示在选中文字上方，避免遮挡
      setFloatingMenuPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 50, // 增加距离，避免遮挡选中文字
      })
      setShowFloatingMenu(true)
      console.log('Menu should show now')
    } else {
      console.log('No valid selection, hiding menu')
      setShowFloatingMenu(false)
    }
  }, [])

  // 添加文本选择事件监听 - 使用与基础测试相同的成功方法
  useEffect(() => {
    console.log('Setting up event listeners')
    // 全局选择变化监听 - 这是最可靠的方法
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

  // 处理悬浮菜单命令
  const handleFloatingMenuFormat = useCallback(
    (command: string, value?: string): boolean => {
      console.log('FloatingMenu command:', command, 'value:', value)
      if (!editor) {
        console.log('No editor available')
        return false
      }

      try {
        switch (command) {
          case 'bold':
            editor.chain().focus().toggleBold().run()
            break
          case 'italic':
            editor.chain().focus().toggleItalic().run()
            break
          case 'underline':
            editor.chain().focus().toggleUnderline().run()
            break
          case 'strikeThrough':
            editor.chain().focus().toggleStrike().run()
            break
          case 'insertText':
            if (value === '`') {
              editor.chain().focus().toggleCode().run()
            }
            break
          case 'createLink':
            if (value) {
              editor.chain().focus().setLink({ href: value }).run()
            }
            break
          case 'heading1':
            editor.chain().focus().setHeading({ level: 1 }).run()
            break
          case 'heading2':
            editor.chain().focus().setHeading({ level: 2 }).run()
            break
          case 'heading3':
            editor.chain().focus().setHeading({ level: 3 }).run()
            break
          case 'heading4':
            editor.chain().focus().setHeading({ level: 4 }).run()
            break
          case 'heading5':
            editor.chain().focus().setHeading({ level: 5 }).run()
            break
          case 'heading6':
            editor.chain().focus().setHeading({ level: 6 }).run()
            break
          case 'paragraph':
            editor.chain().focus().setParagraph().run()
            break
          case 'formatBlock':
            switch (value) {
              case 'h1':
                editor.chain().focus().setHeading({ level: 1 }).run()
                break
              case 'h2':
                editor.chain().focus().setHeading({ level: 2 }).run()
                break
              case 'h3':
                editor.chain().focus().setHeading({ level: 3 }).run()
                break
              case 'h4':
                editor.chain().focus().setHeading({ level: 4 }).run()
                break
              case 'h5':
                editor.chain().focus().setHeading({ level: 5 }).run()
                break
              case 'h6':
                editor.chain().focus().setHeading({ level: 6 }).run()
                break
              case 'p':
                editor.chain().focus().setParagraph().run()
                break
              default:
                return false
            }
            break
          case 'changeBlockType':
            console.log('changeBlockType with value:', value)
            // 确保编辑器有焦点并且选择存在
            if (!editor.isFocused) {
              editor.commands.focus()
            }

            switch (value) {
              case 'paragraph':
                editor.chain().focus().setParagraph().run()
                break
              case 'heading1':
                console.log(
                  'Setting heading1, selection:',
                  window.getSelection()?.toString()
                )
                const result1 = editor
                  .chain()
                  .focus()
                  .setHeading({ level: 1 })
                  .run()
                console.log('setHeading result:', result1)
                console.log('Editor content after heading1:', editor.getHTML())
                break
              case 'heading2':
                console.log(
                  'Setting heading2, selection:',
                  window.getSelection()?.toString()
                )
                editor.chain().focus().setHeading({ level: 2 }).run()
                break
              case 'heading3':
                console.log(
                  'Setting heading3, selection:',
                  window.getSelection()?.toString()
                )
                editor.chain().focus().setHeading({ level: 3 }).run()
                break
              case 'heading4':
                console.log(
                  'Setting heading4, selection:',
                  window.getSelection()?.toString()
                )
                editor.chain().focus().setHeading({ level: 4 }).run()
                break
              case 'heading5':
                console.log(
                  'Setting heading5, selection:',
                  window.getSelection()?.toString()
                )
                editor.chain().focus().setHeading({ level: 5 }).run()
                break
              case 'heading6':
                console.log(
                  'Setting heading6, selection:',
                  window.getSelection()?.toString()
                )
                editor.chain().focus().setHeading({ level: 6 }).run()
                break
              case 'numberedList':
                editor.chain().focus().toggleOrderedList().run()
                break
              case 'bulletList':
                editor.chain().focus().toggleBulletList().run()
                break
              case 'code':
                editor.chain().focus().toggleCodeBlock().run()
                break
              case 'quote':
                editor.chain().focus().toggleBlockquote().run()
                break
              default:
                return false
            }
            break
          case 'justifyLeft':
            editor.chain().focus().setTextAlign('left').run()
            break
          case 'justifyCenter':
            editor.chain().focus().setTextAlign('center').run()
            break
          case 'justifyRight':
            editor.chain().focus().setTextAlign('right').run()
            break
          case 'foreColor':
            if (value) {
              editor.chain().focus().setColor(value).run()
            }
            break
          default:
            return false
        }
        return true
      } catch (error) {
        // Format command failed
        return false
      }
    },
    [editor]
  )

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
    <div className='bg-white relative h-full w-full'>
      {/* 编辑器内容区域 */}
      <div className='p-4 h-full'>
        <div ref={editorRef} className='w-full h-full'>
          <EditorContent
            editor={editor}
            className='min-h-[200px] w-full h-full'
          />
        </div>
      </div>

      {/* 临时简单悬浮菜单用于测试 */}
      {showFloatingMenu && selectedText && (
        <div
          className='fixed z-50 bg-red-500 text-white p-2 rounded shadow-lg'
          style={{
            left: floatingMenuPosition.x,
            top: floatingMenuPosition.y,
            transform: 'translateX(-50%)',
          }}
        >
          <div className='text-sm font-bold'>菜单出现!</div>
          <div className='text-xs'>选中: {selectedText}</div>
        </div>
      )}

      {/* 完整悬浮菜单 */}
      {showFloatingMenu && selectedText && (
        <FloatingMenu
          position={floatingMenuPosition}
          onFormat={handleFloatingMenuFormat}
        />
      )}

      {/* 调试信息 */}
      {process.env.NODE_ENV === 'development' && (
        <div className='fixed bottom-4 right-4 bg-black text-white p-3 text-xs rounded max-w-xs'>
          <div className='font-bold mb-2'>调试信息</div>
          <div>Selected: "{selectedText || 'none'}"</div>
          <div>Show Menu: {showFloatingMenu ? 'yes' : 'no'}</div>
          <div>
            Position: {floatingMenuPosition.x}, {floatingMenuPosition.y}
          </div>
          <div>Editor Ref: {editorRef.current ? 'exists' : 'null'}</div>
          <div>
            Selection:{' '}
            {typeof window !== 'undefined' && window.getSelection()
              ? 'exists'
              : 'null'}
          </div>
        </div>
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
