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

export function FloatingMenu({ position, onFormat, onClose }: FloatingMenuProps) {
  console.log('🎯 FloatingMenu rendering with position:', position)
  return (
    <div
      className="fixed z-50 flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1"
      style={{
        left: position.x,
        top: position.y - 60,
        transform: 'translateX(-50%)'
      }}
    >
      {/* Text Formatting */}
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("bold")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Bold (Ctrl+B)"
      >
        <Bold className="h-4 w-4" />
      </Button>
      
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("italic")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Italic (Ctrl+I)"
      >
        <Italic className="h-4 w-4" />
      </Button>
      
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("underline")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Underline (Ctrl+U)"
      >
        <Underline className="h-4 w-4" />
      </Button>
      
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("strikeThrough")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </Button>

      <div className="w-px h-6 bg-gray-300 mx-1" />

      {/* Code */}
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("insertText", "`")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Inline Code"
      >
        <Code className="h-4 w-4" />
      </Button>

      <div className="w-px h-6 bg-gray-300 mx-1" />

      {/* Link */}
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => {
          const url = prompt("Enter URL:");
          if (url) onFormat("createLink", url);
        }} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Insert Link"
      >
        <Link className="h-4 w-4" />
      </Button>

      <div className="w-px h-6 bg-gray-300 mx-1" />

      {/* Heading */}
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("formatBlock", "h3")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Heading"
      >
        <Type className="h-4 w-4" />
      </Button>

      <div className="w-px h-6 bg-gray-300 mx-1" />

      {/* Alignment */}
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("justifyLeft")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Align Left"
      >
        <AlignLeft className="h-4 w-4" />
      </Button>
      
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("justifyCenter")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Align Center"
      >
        <AlignCenter className="h-4 w-4" />
      </Button>
      
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => onFormat("justifyRight")} 
        className="h-8 w-8 p-0 hover:bg-gray-100"
        title="Align Right"
      >
        <AlignRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
