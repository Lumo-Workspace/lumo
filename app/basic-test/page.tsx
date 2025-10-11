'use client'

import { useState, useRef, useEffect } from 'react'

export default function BasicTest() {
  const [selectedText, setSelectedText] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const contentRef = useRef<HTMLDivElement>(null)

  // 全局选择变化处理
  const handleSelectionChange = () => {
    console.log('Selection change event triggered')

    if (typeof window === 'undefined') {
      console.log('Not in browser environment')
      return
    }

    const selection = window.getSelection()
    console.log('Selection object:', selection)

    if (!selection) {
      console.log('No selection object')
      setSelectedText('')
      setShowMenu(false)
      return
    }

    const text = selection.toString().trim()
    console.log('Selected text:', `"${text}"`)
    setSelectedText(text)

    if (text && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      console.log('Selection rect:', rect)

      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
      })
      setShowMenu(true)
      console.log(
        'Menu should show at:',
        rect.left + rect.width / 2,
        rect.top - 10
      )
    } else {
      setShowMenu(false)
      console.log('No valid selection')
    }
  }

  // 添加全局选择变化监听
  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [])

  const handleMouseUp = (_e: React.MouseEvent) => {
    console.log('Mouse up event triggered')

    // 等待一下让选择完成
    setTimeout(() => {
      console.log('Checking selection...')

      if (typeof window === 'undefined') {
        console.log('Not in browser')
        return
      }

      const selection = window.getSelection()
      console.log('Selection object:', selection)

      if (!selection) {
        console.log('No selection object')
        return
      }

      const text = selection.toString().trim()
      console.log('Selected text:', text)
      setSelectedText(text)

      if (text && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        console.log('Selection rect:', rect)

        setPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
        })
        setShowMenu(true)
        console.log(
          'Menu should show at:',
          rect.left + rect.width / 2,
          rect.top - 10
        )
      } else {
        setShowMenu(false)
        console.log('No valid selection')
      }
    }, 10)
  }

  return (
    <div className='min-h-screen bg-gray-100 p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='bg-white rounded-lg shadow-lg p-6'>
          <h1 className='text-2xl font-bold mb-4'>基础文本选择测试</h1>
          <p className='mb-4 text-gray-600'>
            这个页面使用最基础的方法来测试文本选择和悬浮菜单。
          </p>

          <div
            ref={contentRef}
            className='border rounded-lg p-4 bg-gray-50 min-h-[200px] select-text'
            onMouseUp={handleMouseUp}
            contentEditable
            suppressContentEditableWarning
          >
            <p>这是一个可编辑的测试文档。</p>
            <p>请选择任何文本来查看悬浮菜单。</p>
            <p>你可以尝试选择这段文字。</p>
            <p>如果看到控制台输出，说明事件正在触发。</p>
          </div>

          {/* 悬浮菜单 */}
          {showMenu && selectedText && (
            <div
              className='fixed z-50 bg-green-500 text-white p-3 rounded shadow-lg'
              style={{
                left: position.x,
                top: position.y,
                transform: 'translateX(-50%)',
              }}
            >
              <div className='text-sm font-bold'>✅ 菜单成功显示!</div>
              <div className='text-xs'>选中: "{selectedText}"</div>
              <div className='text-xs'>
                位置: {position.x}, {position.y}
              </div>
            </div>
          )}

          {/* 状态显示 */}
          <div className='mt-6 p-4 bg-gray-100 rounded text-sm'>
            <h3 className='font-bold mb-2'>当前状态：</h3>
            <div className='space-y-1'>
              <div>选中文本: "{selectedText || '无'}"</div>
              <div>显示菜单: {showMenu ? '是' : '否'}</div>
              <div>
                菜单位置: {position.x}, {position.y}
              </div>
              <div className='text-xs text-gray-500 mt-2'>
                提示：打开浏览器开发者工具查看控制台输出
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
