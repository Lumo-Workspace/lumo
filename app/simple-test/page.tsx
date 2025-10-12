'use client'

import { useState } from 'react'

export default function SimpleTest() {
  const [selectedText, setSelectedText] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const handleTextSelection = () => {
    const selection = window.getSelection()
    if (!selection) return

    const text = selection.toString().trim()
    setSelectedText(text)

    if (text && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
      })
      setShowMenu(true)
    } else {
      setShowMenu(false)
    }
  }

  return (
    <div className='min-h-screen bg-gray-100 p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='bg-white rounded-lg shadow-lg p-6'>
          <h1 className='text-2xl font-bold mb-4'>简单悬浮菜单测试</h1>

          <div
            className='border rounded-lg p-4 bg-gray-50 min-h-[200px]'
            onMouseUp={handleTextSelection}
            onKeyUp={handleTextSelection}
          >
            <p>这是一个测试文档。请选择任何文本来查看悬浮菜单。</p>
            <p>你可以尝试选择这段文字，然后使用悬浮菜单进行格式化。</p>
            <p>悬浮菜单应该出现在选中文本的上方。</p>
          </div>

          {/* 简单悬浮菜单 */}
          {showMenu && selectedText && (
            <div
              className='fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex items-center gap-2'
              style={{
                left: position.x,
                top: position.y,
                transform: 'translateX(-50%)',
              }}
            >
              <button className='px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600'>
                粗体
              </button>
              <button className='px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600'>
                斜体
              </button>
              <button className='px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600'>
                下划线
              </button>
            </div>
          )}

          {/* 调试信息 */}
          <div className='mt-4 p-4 bg-gray-100 rounded text-sm'>
            <h3 className='font-bold mb-2'>调试信息：</h3>
            <div>选中文本: "{selectedText || '无'}"</div>
            <div>显示菜单: {showMenu ? '是' : '否'}</div>
            <div>
              菜单位置: {position.x}, {position.y}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
