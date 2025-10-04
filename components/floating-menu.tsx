"use client"

import React from "react"
import { Button } from "@/components/ui/button"
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
  Type
} from "lucide-react"

interface FloatingMenuProps {
  position: { x: number; y: number }
  onFormat: (command: string, value?: string) => void
  onClose: () => void
}

// 格式化按钮配置
const formatButtons = [
  {
    command: "bold",
    icon: Bold,
    title: "Bold (Ctrl+B)",
    tooltip: "加粗"
  },
  {
    command: "italic", 
    icon: Italic,
    title: "Italic (Ctrl+I)",
    tooltip: "斜体"
  },
  {
    command: "underline",
    icon: Underline,
    title: "Underline (Ctrl+U)",
    tooltip: "下划线"
  },
  {
    command: "strikeThrough",
    icon: Strikethrough,
    title: "Strikethrough",
    tooltip: "删除线"
  }
]

const specialButtons = [
  {
    command: "insertText",
    value: "`",
    icon: Code,
    title: "Inline Code",
    tooltip: "行内代码"
  },
  {
    command: "createLink",
    icon: Link,
    title: "Insert Link",
    tooltip: "插入链接",
    isSpecial: true
  },
  {
    command: "formatBlock",
    value: "h3",
    icon: Type,
    title: "Heading",
    tooltip: "标题"
  }
]

const alignmentButtons = [
  {
    command: "justifyLeft",
    icon: AlignLeft,
    title: "Align Left",
    tooltip: "左对齐"
  },
  {
    command: "justifyCenter",
    icon: AlignCenter,
    title: "Align Center", 
    tooltip: "居中对齐"
  },
  {
    command: "justifyRight",
    icon: AlignRight,
    title: "Align Right",
    tooltip: "右对齐"
  }
]

export function FloatingMenu({ position, onFormat, onClose }: FloatingMenuProps) {
  // 处理链接插入
  const handleLinkInsert = () => {
    const url = prompt("输入链接地址:")
    if (url) {
      onFormat("createLink", url)
    }
  }

  // 渲染按钮组
  const renderButtonGroup = (buttons: any[], showSeparator = false) => (
    <>
      {buttons.map((button, index) => {
        const Icon = button.icon
        const handleClick = button.isSpecial 
          ? handleLinkInsert 
          : () => onFormat(button.command, button.value)
        
        return (
          <Button
            key={index}
            variant="ghost"
            size="sm"
            onClick={handleClick}
            className="h-8 w-8 p-0 hover:bg-gray-100"
            title={button.title}
          >
            <Icon className="h-4 w-4" />
          </Button>
        )
      })}
      {showSeparator && <div className="w-px h-6 bg-gray-300 mx-1" />}
    </>
  )

  return (
    <div
      className="fixed z-50 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1"
      style={{
        left: position.x,
        top: position.y - 60,
        transform: 'translateX(-50%)'
      }}
    >
      {/* 文本格式化按钮 */}
      {renderButtonGroup(formatButtons, true)}
      
      {/* 特殊功能按钮 */}
      {renderButtonGroup(specialButtons, true)}
      
      {/* 对齐按钮 */}
      {renderButtonGroup(alignmentButtons)}
    </div>
  )
}
