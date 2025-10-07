'use client'

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

interface FloatingMenuProps {
  position: { x: number; y: number }
  onFormat: (command: string, value?: string) => void
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

export function FloatingMenu({ position, onFormat }: FloatingMenuProps) {
  const [currentHeading, setCurrentHeading] = useState('正文')
  const [showHeadingMenu, setShowHeadingMenu] = useState(false)
  const [showSubmenu, setShowSubmenu] = useState(false)

  // 处理链接插入
  const handleLinkInsert = () => {
    const url = prompt('输入链接地址:')
    if (url) {
      onFormat('createLink', url)
    }
  }

  // 处理标题级别选择
  const handleHeadingSelect = (value: string, label: string) => {
    if (value === 'heading4' && label === '其他标题') {
      setShowSubmenu(true)
      return
    }

    onFormat('changeBlockType', value)
    setCurrentHeading(label)
    setShowHeadingMenu(false)
    setShowSubmenu(false)
  }

  // 处理子菜单选择
  const handleSubmenuSelect = (value: string, label: string) => {
    onFormat('changeBlockType', value)
    setCurrentHeading(label)
    setShowHeadingMenu(false)
    setShowSubmenu(false)
  }

  // 处理文本颜色
  const handleTextColor = () => {
    // 这里可以添加颜色选择器
    onFormat('foreColor', '#3b82f6')
  }

  // 渲染按钮组
  const renderButtonGroup = (buttons: any[], showSeparator = false) => (
    <>
      {buttons.map((button, index) => {
        const Icon = button.icon as any
        const handleClick = button.isSpecial
          ? handleLinkInsert
          : () => onFormat(button.command, button.value)

        return (
          <Button
            key={index}
            variant='ghost'
            size='sm'
            onClick={handleClick}
            className='h-8 w-8 p-0 hover:bg-gray-100'
            title={button.title}
          >
            {typeof Icon === 'string' ? (
              <span className='h-4 w-4 text-gray-600 text-xs font-bold flex items-center justify-center'>
                {Icon}
              </span>
            ) : Icon ? (
              <Icon className='h-4 w-4' />
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
        top: position.y - 60,
        transform: 'translateX(-50%)',
      }}
    >
      {/* 标题级别选择下拉菜单 */}
      <DropdownMenu open={showHeadingMenu} onOpenChange={setShowHeadingMenu}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            className='h-8 px-2 text-sm font-medium hover:bg-gray-100 flex items-center gap-1'
          >
            {(() => {
              const currentOption = headingOptions.find(
                option => option.label === currentHeading
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
            const isSelected = currentHeading === option.label
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => handleHeadingSelect(option.value, option.label)}
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
                const isSelected = currentHeading === option.label
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
