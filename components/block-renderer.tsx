"use client"

import type React from "react"

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

interface BlockRendererProps {
  block: Block
  onUpdate: (blockId: string, content: string) => void
  onKeyDown: (e: React.KeyboardEvent, blockId: string) => void
  onToggleTodo: (blockId: string) => void
  onFocus?: (blockId: string) => void
  onBlur?: () => void
  isFocused?: boolean
  onTextSelection?: (position: { x: number; y: number }, selectedText: string) => void
}

export default function BlockRenderer({
  block,
  onUpdate,
  onKeyDown,
  onToggleTodo,
  onFocus,
  onBlur,
  isFocused,
  onTextSelection,
}: BlockRendererProps) {
  const baseClasses = "w-full bg-transparent border-none outline-none resize-none text-gray-700 placeholder-gray-400"

  const handleMouseUp = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    console.log('🔥 Mouse up in textarea!')
    setTimeout(() => {
      const selection = window.getSelection()
      console.log('Selection after mouseup:', selection)
      
      if (selection && selection.toString().trim()) {
        console.log('Selected text:', selection.toString().trim())
        
        // 使用鼠标位置作为浮动菜单的位置
        const mouseX = e.clientX
        const mouseY = e.clientY
        console.log('Mouse position:', mouseX, mouseY)
        
        onTextSelection?.({
          x: mouseX,
          y: mouseY
        }, selection.toString().trim())
      }
    }, 0)
  }

  const commonProps = {
    value: block.content,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onUpdate(block.id, e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, block.id),
    onFocus: () => onFocus?.(block.id),
    onBlur: () => onBlur?.(),
    onMouseUp: handleMouseUp,
    rows: 1,
    style: { height: "auto" },
    "data-block-id": block.id,
    onInput: (e: React.FormEvent<HTMLTextAreaElement>) => {
      const target = e.target as HTMLTextAreaElement
      if (target.style.height !== target.scrollHeight + "px") {
        target.style.height = "auto"
        target.style.height = target.scrollHeight + "px"
      }
    },
  }

  switch (block.type) {
    case "heading1":
      return (
        <textarea
          key={block.id}
          {...commonProps}
          className={`${baseClasses} text-4xl font-bold leading-relaxed text-gray-800 py-2`}
          placeholder="标题"
        />
      )
    case "heading2":
      return (
        <textarea
          key={block.id}
          {...commonProps}
          className={`${baseClasses} text-2xl font-semibold leading-relaxed text-gray-800 py-1.5`}
          placeholder="标题 2"
        />
      )
    case "heading3":
      return (
        <textarea
          key={block.id}
          {...commonProps}
          className={`${baseClasses} text-xl font-medium leading-relaxed text-gray-800 py-1`}
          placeholder="标题 3"
        />
      )
    case "quote":
      return (
        <div key={block.id} className="border-l-4 border-gray-300 pl-4">
          <textarea {...commonProps} className={`${baseClasses} text-gray-600 italic`} placeholder="空引用" />
        </div>
      )
    case "code":
      return (
        <div key={block.id} className="bg-gray-50 rounded-md p-4 border border-gray-200">
          <textarea
            {...commonProps}
            className={`${baseClasses} font-mono text-sm bg-transparent text-gray-700`}
            placeholder="输入代码..."
            rows={3}
          />
        </div>
      )
    case "todo":
      return (
        <div key={block.id} className="flex items-start gap-2">
          <button
            onClick={() => onToggleTodo(block.id)}
            className="mt-1 w-4 h-4 border border-gray-300 rounded flex items-center justify-center hover:bg-gray-50 transition-colors"
          >
            {block.completed && <div className="w-2 h-2 bg-gray-600 rounded-sm" />}
          </button>
          <textarea
            {...commonProps}
            className={`${baseClasses} flex-1 ${block.completed ? "line-through text-gray-500" : "text-gray-700"}`}
            placeholder="待办事项"
          />
        </div>
      )
    case "divider":
      return <div key={block.id} className="border-t border-gray-200 my-4" />
    default:
      return (
        <textarea
          key={block.id}
          {...commonProps}
          className={`${baseClasses} leading-relaxed`}
          placeholder={isFocused && block.content.trim() === "" ? "输入 '/' 查看命令" : ""}
        />
      )
  }
}
