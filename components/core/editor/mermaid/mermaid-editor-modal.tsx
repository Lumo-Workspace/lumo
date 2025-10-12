'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { X, Copy, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import mermaid from 'mermaid'

interface MermaidEditorModalProps {
  isOpen: boolean
  content: string
  onClose: () => void
  onSave: (content: string) => void
}

export function MermaidEditorModal({
  isOpen,
  content,
  onClose,
  onSave,
}: MermaidEditorModalProps) {
  const [editContent, setEditContent] = useState('')
  const [zoom, setZoom] = useState(100)
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

  // 初始化编辑内容
  useEffect(() => {
    if (isOpen && content) {
      let cleanContent = content.trim()
      // 移除代码块标记
      if (cleanContent.startsWith('```mermaid')) {
        cleanContent = cleanContent
          .replace(/^```mermaid\s*/, '')
          .replace(/\s*```$/, '')
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent
          .replace(/^```\s*/, '')
          .replace(/\s*```$/, '')
      }
      setEditContent(cleanContent)
    }
  }, [isOpen, content])

  // 渲染图表
  const renderDiagram = async (diagramContent: string) => {
    if (!diagramRef.current || !diagramContent.trim()) return

    try {
      diagramRef.current.innerHTML = ''
      const id = `mermaid-modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const { svg } = await mermaid.render(id, diagramContent)
      diagramRef.current.innerHTML = svg
    } catch (error) {
      // Handle mermaid rendering error gracefully
      diagramRef.current.innerHTML = `<div class="text-red-500 p-4 border border-red-200 rounded bg-red-50">图表渲染错误: ${error}</div>`
    }
  }

  // 实时渲染
  useEffect(() => {
    if (isOpen && editContent) {
      const timeoutId = setTimeout(() => {
        renderDiagram(editContent)
      }, 300) // 防抖
      return () => clearTimeout(timeoutId)
    }
    return undefined
  }, [editContent, isOpen])

  // 保存
  const handleSave = () => {
    onSave(editContent)
    onClose()
  }

  // 复制代码
  const handleCopy = () => {
    navigator.clipboard.writeText(editContent)
  }

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
      } else if (e.metaKey || e.ctrlKey) {
        if (e.key === 's') {
          e.preventDefault()
          handleSave()
        } else if (e.key === 'c') {
          e.preventDefault()
          handleCopy()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, editContent])

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center'>
      <div className='bg-white rounded-lg shadow-2xl w-[95vw] h-[90vh] flex flex-col'>
        {/* 头部工具栏 */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200'>
          <div className='flex items-center gap-4'>
            <h2 className='text-lg font-semibold text-gray-900'>
              Mermaid 图表编辑器
            </h2>
            <div className='flex items-center gap-2 text-sm text-gray-500'>
              <span>缩放: {zoom}%</span>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setZoom(Math.max(25, zoom - 25))}
                className='h-6 w-6 p-0'
              >
                <ZoomOut className='h-3 w-3' />
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setZoom(Math.min(200, zoom + 25))}
                className='h-6 w-6 p-0'
              >
                <ZoomIn className='h-3 w-3' />
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleResetZoom}
                className='h-6 w-6 p-0'
              >
                <RotateCcw className='h-3 w-3' />
              </Button>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={handleCopy}
              className='h-8 px-3'
            >
              <Copy className='h-4 w-4 mr-1' />
              复制代码
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={handleSave}
              className='h-8 px-3'
            >
              保存
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={onClose}
              className='h-8 w-8 p-0'
            >
              <X className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* 主要内容区域 */}
        <div className='flex-1 flex'>
          {/* 左侧代码编辑器 */}
          <div className='w-1/2 border-r border-gray-200 flex flex-col'>
            <div className='p-3 bg-gray-50 border-b border-gray-200'>
              <h3 className='text-sm font-medium text-gray-700'>代码</h3>
            </div>
            <div className='flex-1 p-4'>
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className='w-full h-full p-3 border border-gray-300 rounded font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500'
                placeholder='输入 Mermaid 图表代码...'
                spellCheck={false}
              />
            </div>
          </div>

          {/* 右侧预览区域 */}
          <div className='w-1/2 flex flex-col'>
            <div className='p-3 bg-gray-50 border-b border-gray-200'>
              <h3 className='text-sm font-medium text-gray-700'>预览</h3>
            </div>
            <div className='flex-1 p-4 overflow-auto'>
              <div
                ref={diagramRef}
                className='min-h-full flex items-center justify-center'
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'center top',
                }}
              />
            </div>
          </div>
        </div>

        {/* 底部状态栏 */}
        <div className='p-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-sm text-gray-500'>
          <div className='flex items-center gap-4'>
            <span>快捷键: Cmd/Ctrl+S 保存, Cmd/Ctrl+C 复制, Esc 关闭</span>
          </div>
          <div className='flex items-center gap-4'>
            <span>行数: {editContent.split('\n').length}</span>
            <span>字符数: {editContent.length}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
