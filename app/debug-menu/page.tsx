'use client'

import { useState, useRef, useEffect } from 'react'

export default function DebugMenu() {
  const [selectedText, setSelectedText] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [debugInfo, setDebugInfo] = useState<any>({})
  const contentRef = useRef<HTMLDivElement>(null)

  const handleSelection = () => {
    // 检查是否在浏览器环境中
    if (typeof window === 'undefined') {
      setDebugInfo({ error: 'Not in browser environment' })
      setShowMenu(false)
      return
    }

    const selection = window.getSelection()
    if (!selection) {
      setDebugInfo({ error: 'window.getSelection() returned null' })
      setShowMenu(false)
      return
    }

    if (!contentRef.current) {
      setDebugInfo({ error: 'contentRef.current is null' })
      setShowMenu(false)
      return
    }

    const text = selection.toString().trim()
    setSelectedText(text)

    const debug: any = {
      hasSelection: !!selection,
      selectedText: text,
      rangeCount: selection.rangeCount,
      anchorNode: selection.anchorNode?.nodeName,
      focusNode: selection.focusNode?.nodeName,
      isCollapsed: selection.isCollapsed,
      hasContentRef: !!contentRef.current,
      windowExists: typeof window !== 'undefined',
    }

    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      debug.rect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
      }
    }

    setDebugInfo(debug)

    if (text && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      if (rect.width > 0 || rect.height > 0) {
        setPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
        })
        setShowMenu(true)
      } else {
        setShowMenu(false)
      }
    } else {
      setShowMenu(false)
    }
  }

  useEffect(() => {
    const element = contentRef.current
    if (!element) return

    element.addEventListener('mouseup', handleSelection)
    element.addEventListener('keyup', handleSelection)
    document.addEventListener('selectionchange', handleSelection)

    return () => {
      element.removeEventListener('mouseup', handleSelection)
      element.removeEventListener('keyup', handleSelection)
      document.removeEventListener('selectionchange', handleSelection)
    }
  }, [])

  return (
    <div className='min-h-screen bg-gray-100 p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='bg-white rounded-lg shadow-lg p-6'>
          <h1 className='text-2xl font-bold mb-4'>悬浮菜单调试页面</h1>

          <div
            ref={contentRef}
            className='border rounded-lg p-4 bg-gray-50 min-h-[200px] select-text'
            contentEditable
            suppressContentEditableWarning
          >
            <p>这是一个可编辑的测试文档。</p>
            <p>请选择任何文本来查看悬浮菜单。</p>
            <p>你可以尝试选择这段文字。</p>
          </div>

          {/* 简单悬浮菜单 */}
          {showMenu && selectedText && (
            <div
              className='fixed z-50 bg-red-500 text-white p-2 rounded shadow-lg'
              style={{
                left: position.x,
                top: position.y,
                transform: 'translateX(-50%)',
              }}
            >
              <div className='text-sm font-bold'>菜单出现!</div>
              <div className='text-xs'>选中: {selectedText}</div>
            </div>
          )}

          {/* 详细调试信息 */}
          <div className='mt-6 p-4 bg-gray-100 rounded text-sm'>
            <h3 className='font-bold mb-2'>详细调试信息：</h3>
            <div className='space-y-1'>
              <div>选中文本: "{selectedText || '无'}"</div>
              <div>显示菜单: {showMenu ? '是' : '否'}</div>
              <div>
                菜单位置: {position.x}, {position.y}
              </div>
              <div>
                Window对象: {debugInfo.windowExists ? '存在' : '不存在'}
              </div>
              <div>选择对象: {debugInfo.hasSelection ? '存在' : '不存在'}</div>
              <div>选择范围数: {debugInfo.rangeCount || 0}</div>
              <div>是否折叠: {debugInfo.isCollapsed ? '是' : '否'}</div>
              <div>内容引用: {debugInfo.hasContentRef ? '存在' : '不存在'}</div>
              <div>锚点节点: {debugInfo.anchorNode || '无'}</div>
              <div>焦点节点: {debugInfo.focusNode || '无'}</div>
              {debugInfo.rect && (
                <div>
                  选择矩形: x={debugInfo.rect.x}, y={debugInfo.rect.y}, w=
                  {debugInfo.rect.width}, h={debugInfo.rect.height}
                </div>
              )}
              {debugInfo.error && (
                <div className='text-red-600'>错误: {debugInfo.error}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
