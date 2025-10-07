'use client'

import type React from 'react'
import { useRef, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TypographySmall } from '@/components/ui/typography'
import { Plus } from 'lucide-react'
import Breadcrumb from './breadcrumb'
import BlockRenderer from './block-renderer'
import { FloatingMenu } from './floating-menu'

interface Block {
  id: string
  type:
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'paragraph'
    | 'bulletList'
    | 'numberedList'
    | 'todo'
    | 'quote'
    | 'code'
    | 'divider'
    | 'mermaid'
  content: string
  completed?: boolean
}

interface Page {
  id: string
  title: string
  parentId?: string
  children: string[]
  blocks: Block[]
  isExpanded?: boolean
}

interface EditorViewProps {
  pages: Record<string, Page>
  currentPageId: string
  blocks: Block[]
  focusedBlockId: string | null
  onPageClick: (pageId: string) => void
  onUpdateBlock: (blockId: string, content: string) => void
  onKeyDown: (e: React.KeyboardEvent, blockId: string) => void
  onToggleTodo: (blockId: string) => void
  onFocus: (blockId: string) => void
  onBlur: () => void
  onAddBlock?: (afterBlockId?: string) => void
  onChangeBlockType?: (blockId: string, newType: Block['type']) => void
}

export default function EditorView({
  pages,
  currentPageId,
  blocks,
  focusedBlockId,
  onPageClick,
  onUpdateBlock,
  onKeyDown,
  onToggleTodo,
  onFocus,
  onBlur,
  onAddBlock,
  onChangeBlockType,
}: EditorViewProps) {
  const editorRef = useRef<HTMLDivElement>(null)

  // 浮动菜单状态
  const [localSelection, setLocalSelection] = useState<{
    isVisible: boolean
    position: { x: number; y: number }
    selectedText: string
  }>({
    isVisible: false,
    position: { x: 0, y: 0 },
    selectedText: '',
  })

  // 处理文本选择事件
  const handleTextSelection = (
    position: { x: number; y: number },
    selectedText: string,
    blockType?: string
  ) => {
    // 标题类型不显示浮动菜单
    if (blockType && ['heading1', 'heading2', 'heading3'].includes(blockType)) {
      return
    }

    setLocalSelection({
      isVisible: true,
      position,
      selectedText,
    })
  }

  // 处理文本格式化
  const formatText = (command: string, value?: string) => {
    if (command === 'changeBlockType') {
      // 处理块类型切换
      const activeElement = document.activeElement as HTMLElement
      const blockId = activeElement?.getAttribute('data-block-id')
      if (blockId && value && onChangeBlockType) {
        onChangeBlockType(blockId, value as Block['type'])
      }
    } else {
      document.execCommand(command, false, value)
    }
  }

  // 点击外部隐藏浮动菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // 检查点击是否在浮动菜单内部
      const floatingMenu = document.querySelector('.floating-menu')
      if (floatingMenu && floatingMenu.contains(target)) {
        return // 如果点击在浮动菜单内部，不隐藏
      }
      setLocalSelection(prev => ({ ...prev, isVisible: false }))
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // 点击空白处创建新块
  const handleEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const editorContainer = editorRef.current

    if (!editorContainer || !onAddBlock) return

    // 检查是否点击在空白区域
    const isClickingEmptySpace =
      target === editorContainer ||
      target.closest('.space-y-2') ===
        editorContainer.querySelector('.space-y-2')

    if (!isClickingEmptySpace) return

    const blocksContainer = editorContainer.querySelector('.space-y-2')
    if (!blocksContainer) return

    const lastBlock = blocksContainer.lastElementChild
    if (!lastBlock) return

    const lastBlockRect = lastBlock.getBoundingClientRect()
    const clickY = e.clientY
    const tolerance = 20 // 20px 的容差

    // 如果点击位置在最后一个块的下方，创建新块
    if (clickY > lastBlockRect.bottom + tolerance) {
      const lastBlockId = blocks[blocks.length - 1]?.id
      if (lastBlockId) {
        const newBlockId = onAddBlock(lastBlockId)

        // 聚焦到新创建的块
        setTimeout(() => {
          const newBlockElement = document.querySelector(
            `textarea[data-block-id="${newBlockId}"]`
          ) as HTMLTextAreaElement
          if (newBlockElement) {
            newBlockElement.focus()
            newBlockElement.setSelectionRange(0, 0)
          }
        }, 10)
      }
    }
  }

  // 鼠标悬停显示光标
  const handleEditorMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const editorContainer = editorRef.current

    if (!editorContainer) return

    const isHoveringEmptySpace =
      target === editorContainer ||
      target.closest('.space-y-2') ===
        editorContainer.querySelector('.space-y-2')

    if (!isHoveringEmptySpace) {
      editorContainer.style.cursor = 'default'
      return
    }

    const blocksContainer = editorContainer.querySelector('.space-y-2')
    if (!blocksContainer) return

    const lastBlock = blocksContainer.lastElementChild
    if (!lastBlock) return

    const lastBlockRect = lastBlock.getBoundingClientRect()
    const mouseY = e.clientY
    const tolerance = 20

    // 如果鼠标在最后一个块的下方，显示文本光标
    editorContainer.style.cursor =
      mouseY > lastBlockRect.bottom + tolerance ? 'text' : 'default'
  }

  return (
    <div className='flex-1 flex flex-col'>
      {/* 面包屑导航 */}
      <Breadcrumb
        pages={pages}
        currentPageId={currentPageId}
        onPageClick={onPageClick}
      />

      {/* 最近修改时间 */}
      <div className='px-6 py-1 border-b border-gray-100'>
        <TypographySmall className='text-muted-foreground'>
          最近修改: 16 分钟前
        </TypographySmall>
      </div>

      {/* 编辑器主体 */}
      <div className='flex-1 overflow-auto bg-gray-25'>
        <div
          className='max-w-3xl mx-auto px-6 py-8'
          ref={editorRef}
          onClick={handleEditorClick}
          onMouseMove={handleEditorMouseMove}
        >
          <div className='space-y-2'>
            {blocks.map(block => (
              <div key={block.id} className='group relative'>
                {/* 添加块按钮 */}
                <div className='absolute -left-6 top-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                  <Button variant='ghost' size='sm' className='w-5 h-5 p-0'>
                    <Plus className='w-3 h-3' />
                  </Button>
                </div>

                {/* 块渲染器 */}
                <BlockRenderer
                  block={block}
                  onUpdate={onUpdateBlock}
                  onKeyDown={onKeyDown}
                  onToggleTodo={onToggleTodo}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  isFocused={focusedBlockId === block.id}
                  onTextSelection={handleTextSelection}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 浮动菜单 */}
      {localSelection.isVisible && (
        <FloatingMenu
          position={localSelection.position}
          onFormat={formatText}
        />
      )}
    </div>
  )
}
