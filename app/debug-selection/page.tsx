'use client'

import { useState, useEffect, useRef } from 'react'

export default function DebugSelection() {
  const [logs, setLogs] = useState<string[]>([])
  const [selectedText, setSelectedText] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)

  const addLog = (message: string) => {
    console.log(message)
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }

  const handleTextSelection = () => {
    addLog('handleTextSelection called')
    if (typeof window === 'undefined') {
      addLog('Not in browser environment')
      return
    }

    const selection = window.getSelection()
    addLog(`Selection object: ${selection ? 'exists' : 'null'}`)

    if (!selection) {
      addLog('No selection object')
      setSelectedText('')
      return
    }

    const text = selection.toString().trim()
    addLog(`Selected text: "${text}"`)
    setSelectedText(text)

    if (text && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      addLog(
        `Selection rect: ${rect.width}x${rect.height} at (${rect.left}, ${rect.top})`
      )
    } else {
      addLog('No valid selection')
    }
  }

  useEffect(() => {
    addLog('Setting up event listeners')
    document.addEventListener('selectionchange', handleTextSelection)

    return () => {
      document.removeEventListener('selectionchange', handleTextSelection)
    }
  }, [])

  return (
    <div className='min-h-screen bg-gray-100 p-8'>
      <div className='max-w-4xl mx-auto'>
        <div className='bg-white rounded-lg shadow-lg p-6'>
          <h1 className='text-2xl font-bold mb-4'>文本选择调试</h1>

          <div
            ref={editorRef}
            className='border rounded-lg p-4 min-h-[200px] bg-gray-50 mb-4'
            contentEditable
            suppressContentEditableWarning
          >
            <p>这是一个可编辑的测试区域。</p>
            <p>请在这里输入一些文本，然后选择文本。</p>
            <p>观察右侧的日志输出。</p>
          </div>

          <div className='grid grid-cols-2 gap-6'>
            <div>
              <h2 className='text-lg font-semibold mb-2'>当前选中文本</h2>
              <div className='bg-gray-100 p-3 rounded border'>
                {selectedText || '无选中文本'}
              </div>
            </div>

            <div>
              <h2 className='text-lg font-semibold mb-2'>调试日志</h2>
              <div className='bg-gray-100 p-3 rounded border max-h-96 overflow-y-auto'>
                {logs.length === 0 ? (
                  <p className='text-gray-500'>等待事件...</p>
                ) : (
                  logs.map((log, index) => (
                    <div key={index} className='text-sm font-mono mb-1'>
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className='mt-4 text-sm text-gray-600'>
            <p>
              <strong>测试步骤：</strong>
            </p>
            <ol className='list-decimal list-inside space-y-1'>
              <li>在编辑区域输入一些文本</li>
              <li>用鼠标选择一些文本</li>
              <li>观察调试日志的输出</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
