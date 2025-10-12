'use client'

import './FloatingMenu.scss'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  List,
  CheckSquare,
  Quote,
  Palette,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Highlighter,
  Layers,
  ListOrdered,
} from 'lucide-react'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'

interface FloatingMenuProps {
  position: { x: number; y: number }
  editor?: Editor
  onFormat?: (command: string, value?: string) => boolean
}

// 标题级别选项
const headingOptions = [
  { value: 'paragraph', label: '正文', icon: Type },
  { value: 'heading1', label: '一级标题', icon: 'H1' },
  { value: 'heading2', label: '二级标题', icon: 'H2' },
  { value: 'heading3', label: '三级标题', icon: 'H3' },
  { value: 'heading4', label: '其他标题', icon: 'Hn', hasSubmenu: true },
  { value: 'numberedList', label: '有序列表', icon: ListOrdered },
  { value: 'bulletList', label: '无序列表', icon: List },
  { value: 'todo', label: '任务', icon: CheckSquare },
  { value: 'code', label: '代码块', icon: Code },
  { value: 'quote', label: '引用', icon: Quote },
  { value: 'highlight', label: '高亮块', icon: Highlighter },
  { value: 'sync', label: '同步块', icon: Layers },
]

// 其他标题子菜单
const otherHeadingOptions = [
  { value: 'heading4', label: '四级标题', icon: 'H4' },
  { value: 'heading5', label: '五级标题', icon: 'H5' },
  { value: 'heading6', label: '六级标题', icon: 'H6' },
  { value: 'heading7', label: '七级标题', icon: 'H7' },
  { value: 'heading8', label: '八级标题', icon: 'H8' },
  { value: 'heading9', label: '九级标题', icon: 'H9' },
]

// 格式化按钮配置
const formatButtons = [
  {
    command: 'bold',
    icon: Bold,
    title: 'Bold (Ctrl+B)',
    tooltip: '加粗',
  },
  {
    command: 'italic',
    icon: Italic,
    title: 'Italic (Ctrl+I)',
    tooltip: '斜体',
  },
  {
    command: 'underline',
    icon: Underline,
    title: 'Underline (Ctrl+U)',
    tooltip: '下划线',
  },
  {
    command: 'strikeThrough',
    icon: Strikethrough,
    title: 'Strikethrough',
    tooltip: '删除线',
  },
]

const specialButtons = [
  {
    command: 'insertText',
    value: '`',
    icon: Code,
    title: 'Inline Code',
    tooltip: '行内代码',
  },
  {
    command: 'createLink',
    icon: Link,
    title: 'Insert Link',
    tooltip: '插入链接',
    isSpecial: true,
  },
  {
    command: 'formatBlock',
    value: 'h3',
    icon: Type,
    title: 'Heading',
    tooltip: '标题',
  },
]

const alignmentButtons = [
  {
    command: 'justifyLeft',
    icon: AlignLeft,
    title: 'Align Left',
    tooltip: '左对齐',
  },
  {
    command: 'justifyCenter',
    icon: AlignCenter,
    title: 'Align Center',
    tooltip: '居中对齐',
  },
  {
    command: 'justifyRight',
    icon: AlignRight,
    title: 'Align Right',
    tooltip: '右对齐',
  },
]

// 自定义 Hook 来安全地使用 useEditorState
function useEditorStateSafe(editor: Editor | undefined) {
  const editorState = useEditorState({
    editor: editor || ({} as Editor), // 提供一个空对象作为默认值
    selector: ctx => {
      if (!editor) return {}
      return {
        isBold: ctx.editor.isActive('bold') ?? false,
        canBold: ctx.editor.can().chain().toggleBold().run() ?? false,
        isItalic: ctx.editor.isActive('italic') ?? false,
        canItalic: ctx.editor.can().chain().toggleItalic().run() ?? false,
        isStrike: ctx.editor.isActive('strike') ?? false,
        canStrike: ctx.editor.can().chain().toggleStrike().run() ?? false,
        isUnderline: ctx.editor.isActive('underline') ?? false,
        canUnderline: ctx.editor.can().chain().toggleUnderline().run() ?? false,
        isParagraph: ctx.editor.isActive('paragraph') ?? false,
        isHeading1: ctx.editor.isActive('heading', { level: 1 }) ?? false,
        isHeading2: ctx.editor.isActive('heading', { level: 2 }) ?? false,
        isHeading3: ctx.editor.isActive('heading', { level: 3 }) ?? false,
        isHeading4: ctx.editor.isActive('heading', { level: 4 }) ?? false,
        isHeading5: ctx.editor.isActive('heading', { level: 5 }) ?? false,
        isHeading6: ctx.editor.isActive('heading', { level: 6 }) ?? false,
        isBulletList: ctx.editor.isActive('bulletList') ?? false,
        isOrderedList: ctx.editor.isActive('orderedList') ?? false,
        isTaskList: ctx.editor.isActive('taskList') ?? false,
        isCodeBlock: ctx.editor.isActive('codeBlock') ?? false,
        isInlineCode: ctx.editor.isActive('code') ?? false,
        isBlockquote: ctx.editor.isActive('blockquote') ?? false,
        isAlignLeft: ctx.editor.isActive({ textAlign: 'left' }) ?? false,
        isAlignCenter: ctx.editor.isActive({ textAlign: 'center' }) ?? false,
        isAlignRight: ctx.editor.isActive({ textAlign: 'right' }) ?? false,
      }
    },
  })

  return editor ? editorState : null
}

export function FloatingMenu({
  position,
  editor,
  onFormat,
}: FloatingMenuProps) {
  // 使用安全的 useEditorState Hook
  const editorState = useEditorStateSafe(editor)

  // 根据当前状态确定标题级别标签
  const getCurrentHeadingLabel = () => {
    if (editor && editorState) {
      if (editorState.isHeading1) return '一级标题'
      if (editorState.isHeading2) return '二级标题'
      if (editorState.isHeading3) return '三级标题'
      if (editorState.isHeading4) return '四级标题'
      if (editorState.isHeading5) return '五级标题'
      if (editorState.isHeading6) return '六级标题'
      if (editorState.isBulletList) return '无序列表'
      if (editorState.isOrderedList) return '有序列表'
      if (editorState.isTaskList) return '任务'
      if (editorState.isCodeBlock) return '代码块'
      if (editorState.isBlockquote) return '引用'
      if (editorState.isParagraph) return '正文'
    }
    return '正文'
  }

  const [showHeadingMenu, setShowHeadingMenu] = useState(false)
  const [showSubmenu, setShowSubmenu] = useState(false)

  // 处理链接插入
  const handleLinkInsert = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const url = prompt('输入链接地址:')
    if (url) {
      if (editor) {
        editor.chain().focus().setLink({ href: url }).run()
      } else if (onFormat) {
        onFormat('createLink', url)
      }
    }
  }

  // 处理标题级别选择
  const handleHeadingSelect = (value: string, label: string) => {
    if (value === 'heading4' && label === '其他标题') {
      setShowSubmenu(true)
      return
    }

    if (editor) {
      // TipTap 编辑器模式
      switch (value) {
        case 'paragraph':
          editor.chain().focus().setParagraph().run()
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
        case 'todo':
          editor.chain().focus().toggleTaskList().run()
          break
      }
    } else if (onFormat) {
      // 传统编辑器模式
      onFormat('changeBlockType', value)
    }

    setShowHeadingMenu(false)
    setShowSubmenu(false)
  }

  // 处理子菜单选择
  const handleSubmenuSelect = (value: string, _label: string) => {
    if (editor) {
      // TipTap 编辑器模式
      switch (value) {
        case 'heading4':
          editor.chain().focus().setHeading({ level: 4 }).run()
          break
        case 'heading5':
          editor.chain().focus().setHeading({ level: 5 }).run()
          break
        case 'heading6':
          editor.chain().focus().setHeading({ level: 6 }).run()
          break
      }
    } else if (onFormat) {
      // 传统编辑器模式
      onFormat('changeBlockType', value)
    }

    setShowHeadingMenu(false)
    setShowSubmenu(false)
  }

  // 处理文本颜色
  const handleTextColor = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 这里可以添加颜色选择器
    if (editor) {
      editor.chain().focus().setColor('#3b82f6').run()
    } else if (onFormat) {
      onFormat('foreColor', '#3b82f6')
    }
  }

  // 渲染按钮组
  const renderButtonGroup = (buttons: any[], showSeparator = false) => (
    <>
      {buttons.map((button, index) => {
        const Icon = button.icon as any

        // 根据 editorState 确定按钮是否激活
        const isActive = (() => {
          if (editor && editorState) {
            switch (button.command) {
              case 'bold':
                return editorState.isBold
              case 'italic':
                return editorState.isItalic
              case 'underline':
                return editorState.isUnderline
              case 'strikethrough':
                return editorState.isStrike
              case 'insertText':
                return editorState.isInlineCode
              case 'justifyLeft':
                return editorState.isAlignLeft
              case 'justifyCenter':
                return editorState.isAlignCenter
              case 'justifyRight':
                return editorState.isAlignRight
              default:
                return false
            }
          }
          return false
        })()

        // 根据 editorState 确定按钮是否可用
        const isDisabled = (() => {
          if (editor && editorState) {
            switch (button.command) {
              case 'bold':
                return !editorState.canBold
              case 'italic':
                return !editorState.canItalic
              case 'underline':
                return !editorState.canUnderline
              case 'strikethrough':
                return !editorState.canStrike
              default:
                return false
            }
          }
          return false
        })()

        const handleClick = button.isSpecial
          ? handleLinkInsert
          : () => {
              if (editor) {
                // TipTap 编辑器模式
                switch (button.command) {
                  case 'bold':
                    editor.chain().focus().toggleBold().run()
                    break
                  case 'italic':
                    editor.chain().focus().toggleItalic().run()
                    break
                  case 'underline':
                    editor.chain().focus().toggleUnderline().run()
                    break
                  case 'strikethrough':
                    editor.chain().focus().toggleStrike().run()
                    break
                  case 'insertText':
                    editor.chain().focus().toggleCode().run()
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
                  default:
                    break
                }
              } else if (onFormat) {
                // 传统编辑器模式
                onFormat(button.command, button.value)
              }
            }

        return (
          <Button
            key={index}
            variant='ghost'
            size='sm'
            onClick={handleClick}
            disabled={isDisabled}
            className={`h-8 w-8 p-0 hover:bg-gray-100 ${
              isActive ? 'bg-blue-100 text-blue-600' : ''
            } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={button.title}
          >
            {typeof Icon === 'string' ? (
              <span
                className={`h-4 w-4 text-xs font-bold flex items-center justify-center ${
                  isActive ? 'text-blue-600' : 'text-gray-600'
                }`}
              >
                {Icon}
              </span>
            ) : Icon ? (
              <Icon
                className={`h-4 w-4 ${isActive ? 'text-blue-600' : 'text-gray-600'}`}
              />
            ) : null}
          </Button>
        )
      })}
      {showSeparator && <div className='w-px h-6 bg-gray-300 mx-1' />}
    </>
  )

  return (
    <div
      className='floating-menu fixed z-50 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1'
      style={{
        left: position.x,
        top: position.y,
        transform: 'translateX(-50%)',
      }}
      onClick={e => {
        // 阻止事件冒泡，防止点击菜单时菜单消失
        e.stopPropagation()
      }}
    >
      {/* 标题级别选择下拉菜单 */}
      <DropdownMenu
        open={showHeadingMenu}
        onOpenChange={open => {
          setShowHeadingMenu(open)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            className='h-8 px-2 text-sm font-medium hover:bg-gray-100 flex items-center gap-1'
          >
            {(() => {
              const currentLabel = getCurrentHeadingLabel()
              const currentOption = headingOptions.find(
                option => option.label === currentLabel
              )
              const Icon = currentOption?.icon
              return (
                <>
                  {typeof Icon === 'string' ? (
                    <span className='w-4 h-4 text-gray-600 text-xs font-bold flex items-center justify-center'>
                      {Icon}
                    </span>
                  ) : Icon ? (
                    <Icon className='w-4 h-4 text-gray-600' />
                  ) : null}
                </>
              )
            })()}
            <ChevronDown className='w-3 h-3 text-gray-500' />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className='w-48'>
          {headingOptions.map(option => {
            const Icon = option.icon as any
            const isSelected = getCurrentHeadingLabel() === option.label
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleHeadingSelect(option.value, option.label)
                }}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm ${
                  isSelected ? 'bg-blue-50 text-blue-600' : ''
                }`}
              >
                {typeof Icon === 'string' ? (
                  <span className='w-4 h-4 text-gray-600 text-xs font-bold flex items-center justify-center'>
                    {Icon}
                  </span>
                ) : Icon ? (
                  <Icon className='w-4 h-4 text-gray-600' />
                ) : null}
                <span className='text-gray-900 flex-1'>{option.label}</span>
                {isSelected && <span className='text-blue-600'>✓</span>}
                {option.hasSubmenu && (
                  <ChevronRight className='w-4 h-4 text-gray-400' />
                )}
              </DropdownMenuItem>
            )
          })}
          {showSubmenu && (
            <>
              <DropdownMenuSeparator />
              {otherHeadingOptions.map(option => {
                const Icon = option.icon as any
                const isSelected = getCurrentHeadingLabel() === option.label
                return (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() =>
                      handleSubmenuSelect(option.value, option.label)
                    }
                    className={`flex items-center gap-2 px-2 py-1.5 text-sm ${
                      isSelected ? 'bg-blue-50 text-blue-600' : ''
                    }`}
                  >
                    {typeof Icon === 'string' ? (
                      <span className='w-4 h-4 text-gray-600 text-xs font-bold flex items-center justify-center'>
                        {Icon}
                      </span>
                    ) : Icon ? (
                      <Icon className='w-4 h-4 text-gray-600' />
                    ) : null}
                    <span className='text-gray-900 flex-1'>{option.label}</span>
                    {isSelected && <span className='text-blue-600'>✓</span>}
                  </DropdownMenuItem>
                )
              })}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className='w-px h-6 bg-gray-300 mx-1' />

      {/* 文本格式化按钮 */}
      {renderButtonGroup(formatButtons, true)}

      {/* 特殊功能按钮 */}
      {renderButtonGroup(specialButtons, true)}

      {/* 对齐按钮 */}
      {renderButtonGroup(alignmentButtons)}

      <div className='w-px h-6 bg-gray-300 mx-1' />

      {/* 文本颜色 */}
      <Button
        variant='ghost'
        size='sm'
        onClick={handleTextColor}
        className='h-8 w-8 p-0 hover:bg-gray-100'
        title='文本颜色'
      >
        <Palette className='h-4 w-4' />
      </Button>

      {/* 更多选项 */}
      <Button
        variant='ghost'
        size='sm'
        className='h-8 w-8 p-0 hover:bg-gray-100'
        title='更多选项'
      >
        <MoreHorizontal className='h-4 w-4' />
      </Button>
    </div>
  )
}
