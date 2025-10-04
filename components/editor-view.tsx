"use client"

import type React from "react"
import { useRef, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import Breadcrumb from "./breadcrumb"
import BlockRenderer from "./block-renderer"
import { FloatingMenu } from "./floating-menu"

interface Block {
  id: string
  type:
    | "heading1"
    | "heading2"
    | "heading3"
    | "paragraph"
    | "bulletList"
    | "numberedList"
    | "todo"
    | "quote"
    | "code"
    | "divider"
    | "mermaid"
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
}: EditorViewProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  
  // 本地浮动菜单状态
  const [localSelection, setLocalSelection] = useState<{
    isVisible: boolean
    position: { x: number; y: number }
    selectedText: string
  }>({
    isVisible: false,
    position: { x: 0, y: 0 },
    selectedText: ""
  })

  // console.log('=== EditorView Component Loaded ===')

  // 处理来自BlockRenderer的文本选择
  const handleTextSelection = (position: { x: number; y: number }, selectedText: string, blockType?: string) => {
    console.log('🎯 Text selection received in EditorView:', position, selectedText, 'Block type:', blockType)
    
    // 如果是标题类型，不显示浮动菜单
    if (blockType && ['heading1', 'heading2', 'heading3'].includes(blockType)) {
      console.log('🎯 Heading selected, not showing floating menu')
      return
    }
    
    setLocalSelection({
      isVisible: true,
      position,
      selectedText
    })
  }

  // 设置点击外部隐藏菜单的事件监听器
  useEffect(() => {
    const handleClickOutside = () => {
      setLocalSelection(prev => ({ ...prev, isVisible: false }))
    }
    
    document.addEventListener('click', handleClickOutside)
    
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [])

  // Handle text formatting
  const formatText = (command: string, value?: string) => {
    document.execCommand(command, false, value)
  }

  // Handle clicking on empty space to create new block
  const handleEditorClick = (e: React.MouseEvent) => {
    // 检查点击是否在空白区域
    const target = e.target as HTMLElement
    const editorContainer = editorRef.current
    
    if (!editorContainer || !onAddBlock) return
    
    // 检查点击的元素是否是编辑器容器本身或其直接子元素
    if (target === editorContainer || target.closest('.space-y-2') === editorContainer.querySelector('.space-y-2')) {
      // 检查是否点击在最后一个块的下方
      const blocksContainer = editorContainer.querySelector('.space-y-2')
      if (!blocksContainer) return
      
      const lastBlock = blocksContainer.lastElementChild
      if (!lastBlock) return
      
      const lastBlockRect = lastBlock.getBoundingClientRect()
      const clickY = e.clientY
      
      // 如果点击位置在最后一个块的下方，创建新块
      if (clickY > lastBlockRect.bottom + 20) { // 20px 的容差
        const lastBlockId = blocks[blocks.length - 1]?.id
        if (lastBlockId) {
          const newBlockId = onAddBlock(lastBlockId)
          
          // 聚焦到新创建的块
          setTimeout(() => {
            const newBlockElement = document.querySelector(`textarea[data-block-id="${newBlockId}"]`) as HTMLTextAreaElement
            if (newBlockElement) {
              newBlockElement.focus()
              // 将光标移动到文本区域的开始位置
              newBlockElement.setSelectionRange(0, 0)
            }
          }, 10)
        }
      }
    }
  }

  // Handle mouse hover to show cursor
  const handleEditorMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const editorContainer = editorRef.current
    
    if (!editorContainer) return
    
    // 检查鼠标是否在空白区域
    if (target === editorContainer || target.closest('.space-y-2') === editorContainer.querySelector('.space-y-2')) {
      const blocksContainer = editorContainer.querySelector('.space-y-2')
      if (!blocksContainer) return
      
      const lastBlock = blocksContainer.lastElementChild
      if (!lastBlock) return
      
      const lastBlockRect = lastBlock.getBoundingClientRect()
      const mouseY = e.clientY
      
      // 如果鼠标在最后一个块的下方，显示文本光标
      if (mouseY > lastBlockRect.bottom + 20) {
        editorContainer.style.cursor = 'text'
      } else {
        editorContainer.style.cursor = 'default'
      }
    } else {
      editorContainer.style.cursor = 'default'
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <Breadcrumb pages={pages} currentPageId={currentPageId} onPageClick={onPageClick} />

      <div className="px-6 py-1 text-xs text-gray-500 border-b border-gray-100">最近修改: 16 分钟前</div>

      <div className="flex-1 overflow-auto bg-gray-25">
        <div className="max-w-3xl mx-auto px-6 py-8" ref={editorRef} onClick={handleEditorClick} onMouseMove={handleEditorMouseMove}>
          <div className="space-y-2">
            {blocks.map((block) => (
              <div key={block.id} className="group relative">
                <div className="absolute -left-6 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" className="w-5 h-5 p-0">
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
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

      {/* Floating Menu */}
      {localSelection.isVisible && (
        <FloatingMenu
          position={localSelection.position}
          onFormat={formatText}
          onClose={() => setLocalSelection(prev => ({ ...prev, isVisible: false }))}
        />
      )}
    </div>
  )
}
