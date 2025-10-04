"use client"

import React, { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react"
import mermaid from "mermaid"

interface MermaidPreviewModalProps {
  isOpen: boolean
  content: string
  onClose: () => void
}

export function MermaidPreviewModal({ isOpen, content, onClose }: MermaidPreviewModalProps) {
  const [zoom, setZoom] = useState(100)
  const diagramRef = useRef<HTMLDivElement>(null)

  // 初始化 Mermaid
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
    })
  }, [])

  // 渲染图表
  const renderDiagram = async (diagramContent: string) => {
    if (!diagramRef.current || !diagramContent.trim()) return

    try {
      diagramRef.current.innerHTML = ''
      
      // 提取纯 Mermaid 语法（移除代码块标记）
      let cleanContent = diagramContent.trim()
      if (cleanContent.startsWith('```mermaid')) {
        cleanContent = cleanContent.replace(/^```mermaid\s*/, '').replace(/\s*```$/, '')
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
      }
      
      const id = `mermaid-preview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const { svg } = await mermaid.render(id, cleanContent)
      diagramRef.current.innerHTML = svg
    } catch (error) {
      console.error('Mermaid rendering error:', error)
      diagramRef.current.innerHTML = `<div class="text-red-500 p-4 border border-red-200 rounded bg-red-50">图表渲染错误: ${error}</div>`
    }
  }

  // 渲染图表
  useEffect(() => {
    if (isOpen && content) {
      renderDiagram(content)
    }
  }, [isOpen, content])

  // 重置缩放
  const handleResetZoom = () => {
    setZoom(100)
  }

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return
      
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-[95vw] h-[90vh] flex flex-col">
        {/* 头部工具栏 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-900">Mermaid 图表预览</h2>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>缩放: {zoom}%</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(Math.max(25, zoom - 25))}
                className="h-6 w-6 p-0"
              >
                <ZoomOut className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(Math.min(200, zoom + 25))}
                className="h-6 w-6 p-0"
              >
                <ZoomIn className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetZoom}
                className="h-6 w-6 p-0"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 预览区域 */}
        <div className="flex-1 p-4 overflow-auto">
          <div 
            ref={diagramRef} 
            className="min-h-full flex items-center justify-center"
            style={{ 
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'center top'
            }}
          />
        </div>

        {/* 底部状态栏 */}
        <div className="p-3 bg-gray-50 border-t border-gray-200 flex items-center justify-center text-sm text-gray-500">
          <span>按 Esc 键关闭预览</span>
        </div>
      </div>
    </div>
  )
}
