"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"
import { MermaidDiagram } from "./mermaid-diagram"

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

interface BlockRendererProps {
  block: Block
  onUpdate: (blockId: string, content: string) => void
  onKeyDown: (e: React.KeyboardEvent, blockId: string) => void
  onToggleTodo: (blockId: string) => void
  onFocus?: (blockId: string) => void
  onBlur?: () => void
  isFocused?: boolean
  onTextSelection?: (position: { x: number; y: number }, selectedText: string, blockType?: string) => void
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
  // 基础样式类
  const baseClasses = "w-full bg-transparent border-none outline-none resize-none text-gray-700 placeholder-gray-400"

  // 处理文本选择事件
  const handleMouseUp = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    setTimeout(() => {
      const selection = window.getSelection()
      
      if (selection && selection.toString().trim()) {
        const selectedText = selection.toString().trim()
        const mouseX = e.clientX
        const mouseY = e.clientY
        
        onTextSelection?.({
          x: mouseX,
          y: mouseY
        }, selectedText, block.type)
      }
    }, 0)
  }

  // 自动调整高度
  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement
    if (target.style.height !== target.scrollHeight + "px") {
      target.style.height = "auto"
      target.style.height = target.scrollHeight + "px"
    }
  }

  // 通用属性
  const commonProps = {
    value: block.content,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onUpdate(block.id, e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, block.id),
    onFocus: () => onFocus?.(block.id),
    onBlur: () => onBlur?.(),
    onMouseUp: handleMouseUp,
    onInput: handleInput,
    rows: 1,
    style: { height: "auto" },
    "data-block-id": block.id,
  }

  // 渲染不同类型的块
  const renderBlock = () => {
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
            <textarea 
              {...commonProps} 
              className={`${baseClasses} text-gray-600 italic`} 
              placeholder="空引用" 
            />
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

      case "mermaid":
        return (
          <MermaidDiagram
            key={block.id}
            content={block.content}
            onUpdate={(content) => onUpdate(block.id, content)}
            isEditing={isFocused && block.content.trim() === ""}
          />
        )

      default:
        return (
          <textarea
            key={block.id}
            {...commonProps}
            className={`${baseClasses} leading-relaxed py-0`}
            placeholder={isFocused && block.content.trim() === "" ? "输入 '/' 查看命令" : ""}
          />
        )
    }
  }

  return renderBlock()
}
