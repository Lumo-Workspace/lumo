"use client"

import React, { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"
import { MermaidPreviewModal } from "./mermaid-preview-modal"

interface MermaidDiagramProps {
  content: string
  onUpdate?: (content: string) => void
  isEditing?: boolean
}

export function MermaidDiagram({ content, onUpdate, isEditing = false }: MermaidDiagramProps) {
  const [isEditingMode, setIsEditingMode] = useState(isEditing)
  const [editContent, setEditContent] = useState(content)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const diagramRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      // 清除之前的内容
      diagramRef.current.innerHTML = ''
      
      // 提取纯 Mermaid 语法（移除代码块标记）
      let cleanContent = diagramContent.trim()
      
      // 移除 ```mermaid 和 ``` 标记
      if (cleanContent.startsWith('```mermaid')) {
        cleanContent = cleanContent.replace(/^```mermaid\s*/, '').replace(/\s*```$/, '')
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
      }
      
      // 生成唯一的 ID
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      // 渲染图表
      const { svg } = await mermaid.render(id, cleanContent)
      diagramRef.current.innerHTML = svg
    } catch (error) {
      // Handle mermaid rendering error gracefully
      diagramRef.current.innerHTML = `<div class="text-red-500 p-4 border border-red-200 rounded bg-red-50">图表渲染错误: ${error}</div>`
    }
  }

  // 当内容变化时重新渲染
  useEffect(() => {
    if (!isEditingMode && content) {
      renderDiagram(content)
    }
  }, [content, isEditingMode])

  // 当编辑内容变化时重新渲染
  useEffect(() => {
    if (isEditingMode && editContent) {
      renderDiagram(editContent)
    }
  }, [editContent, isEditingMode])

  // 初始化编辑内容时清理代码块标记
  useEffect(() => {
    if (isEditingMode && content) {
      let cleanContent = content.trim()
      if (cleanContent.startsWith('```mermaid')) {
        cleanContent = cleanContent.replace(/^```mermaid\s*/, '').replace(/\s*```$/, '')
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
      }
      setEditContent(cleanContent)
    }
  }, [isEditingMode, content])

  // 保存编辑
  const handleSave = () => {
    if (onUpdate) {
      onUpdate(editContent)
    }
    setIsEditingMode(false)
  }

  // 取消编辑
  const handleCancel = () => {
    setEditContent(content)
    setIsEditingMode(false)
  }

  // 进入编辑模式
  const handleEdit = () => {
    setIsEditingMode(true)
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 100)
  }

  // 点击图表打开预览模态框
  const handleDiagramClick = () => {
    setIsModalOpen(true)
  }

  if (isEditingMode) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">编辑 Mermaid 图表</h3>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              保存
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              取消
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-64 p-3 border border-gray-300 rounded font-mono text-sm resize-none"
              placeholder="输入 Mermaid 图表代码..."
            />
          </div>
          
          <div className="border border-gray-200 rounded bg-white p-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">预览</h4>
            <div ref={diagramRef} className="min-h-[200px] flex items-center justify-center" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="border border-gray-200 rounded-lg p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">Mermaid 图表</h3>
          <button
            onClick={handleEdit}
            className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            编辑
          </button>
        </div>
        
        <div 
          ref={diagramRef} 
          className="min-h-[200px] flex items-center justify-center cursor-pointer hover:bg-gray-50 rounded transition-colors"
          onClick={handleDiagramClick}
          title="点击预览图表"
        />
      </div>

      <MermaidPreviewModal
        isOpen={isModalOpen}
        content={content}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  )
}
