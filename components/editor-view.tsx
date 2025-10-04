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

  return (
    <div className="flex-1 flex flex-col">
      <Breadcrumb pages={pages} currentPageId={currentPageId} onPageClick={onPageClick} />

      <div className="px-6 py-1 text-xs text-gray-500 border-b border-gray-100">最近修改: 16 分钟前</div>

      <div className="flex-1 overflow-auto bg-gray-25">
        <div className="max-w-3xl mx-auto px-6 py-8" ref={editorRef}>
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
