"use client"
import { Input } from "@/components/ui/input"
import type React from "react"

import { FileText, Hash, List, CheckSquare, Code, Quote, Divide } from "lucide-react"

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
  content: string
  completed?: boolean
}

const blockTypes = [
  { type: "paragraph", label: "文本", icon: FileText, description: "开始写作，使用纯文本。" },
  { type: "heading1", label: "标题 1", icon: Hash, description: "大号标题。" },
  { type: "heading2", label: "标题 2", icon: Hash, description: "中号标题。" },
  { type: "heading3", label: "标题 3", icon: Hash, description: "小号标题。" },
  { type: "bulletList", label: "项目符号列表", icon: List, description: "创建一个简单的项目符号列表。" },
  { type: "numberedList", label: "编号列表", icon: List, description: "创建一个编号列表。" },
  { type: "todo", label: "待办事项", icon: CheckSquare, description: "跟踪任务的待办事项列表。" },
  { type: "quote", label: "引用", icon: Quote, description: "捕获引用。" },
  { type: "code", label: "代码", icon: Code, description: "捕获代码片段。" },
  { type: "divider", label: "分割线", icon: Divide, description: "在视觉上分割块。" },
]

interface SlashMenuProps {
  show: boolean
  position: { x: number; y: number }
  searchQuery: string
  onSearchChange: (query: string) => void
  onBlockTypeSelect: (type: Block["type"]) => void
  onClose?: () => void
}

export default function SlashMenu({
  show,
  position,
  searchQuery,
  onSearchChange,
  onBlockTypeSelect,
  onClose,
}: SlashMenuProps) {
  console.log("[v0] SlashMenu render - show:", show, "position:", position)

  if (!show) return null

  const safeSearchQuery = searchQuery || ""

  const filteredBlockTypes = blockTypes.filter(
    (blockType) =>
      blockType.label.toLowerCase().includes(safeSearchQuery.toLowerCase()) ||
      blockType.description.toLowerCase().includes(safeSearchQuery.toLowerCase()),
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && onClose) {
      onClose()
    }
  }

  return (
    <div
      className="slash-menu fixed z-50 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-2"
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleKeyDown}
    >
      <div className="mb-2">
        <Input
          placeholder="搜索块类型..."
          value={safeSearchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 bg-white border-gray-300 text-gray-900"
          autoFocus
        />
      </div>
      <div className="max-h-64 overflow-auto">
        {filteredBlockTypes.map((blockType) => {
          const IconComponent = blockType.icon
          return (
            <div
              key={blockType.type}
              onClick={() => {
                console.log("[v0] Block type clicked:", blockType.type)
                onBlockTypeSelect(blockType.type as Block["type"])
                if (onClose) onClose()
              }}
              className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 cursor-pointer"
            >
              <IconComponent className="w-4 h-4 text-gray-600" />
              <div className="flex-1">
                <div className="font-medium text-sm text-gray-900">{blockType.label}</div>
                <div className="text-xs text-gray-600">{blockType.description}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
