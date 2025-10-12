'use client'

import type React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, User, X, Maximize2, Minimize2 } from 'lucide-react'

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
}

interface AIChatProps {
  onClose: () => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

export default function AIChat({
  onClose,
  isFullscreen = false,
  onToggleFullscreen,
}: AIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content:
        '你好！我是你的 AI 助手，可以帮你编辑文档、回答问题或提供建议。有什么我可以帮助你的吗？',
      role: 'assistant',
      timestamp: new Date(),
    },
  ])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue.trim(),
      role: 'user',
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    // 模拟 AI 响应
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: '我理解了你的问题。让我来帮你分析一下...',
        role: 'assistant',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, aiMessage])
      setIsLoading(false)
    }, 1000)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className={`flex flex-col h-full bg-white border-r border-gray-200 ${isFullscreen ? 'h-screen' : ''}`}
    >
      {/* Header */}
      <div className='flex items-center justify-between p-4 border-b border-gray-200'>
        <div className='flex items-center gap-2'>
          <Sparkles className='w-5 h-5 text-blue-600' />
          <h2 className='font-semibold text-gray-900'>AI 助手</h2>
        </div>
        <div className='flex items-center gap-1'>
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className='p-1 hover:bg-gray-100 rounded-md transition-colors'
              title={isFullscreen ? '退出全屏' : '全屏显示'}
            >
              {isFullscreen ? (
                <Minimize2 className='w-4 h-4 text-gray-500' />
              ) : (
                <Maximize2 className='w-4 h-4 text-gray-500' />
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className='p-1 hover:bg-gray-100 rounded-md transition-colors'
          >
            <X className='w-4 h-4 text-gray-500' />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className='flex-1 overflow-y-auto p-4 space-y-4'>
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'assistant' && (
              <div className='w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0'>
                <Sparkles className='w-4 h-4 text-blue-600' />
              </div>
            )}
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p className='text-sm whitespace-pre-wrap'>{message.content}</p>
              <p
                className={`text-xs mt-1 ${message.role === 'user' ? 'text-blue-100' : 'text-gray-500'}`}
              >
                {message.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            {message.role === 'user' && (
              <div className='w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0'>
                <User className='w-4 h-4 text-gray-600' />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className='flex gap-3 justify-start'>
            <div className='w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0'>
              <Sparkles className='w-4 h-4 text-blue-600' />
            </div>
            <div className='bg-gray-100 text-gray-900 p-3 rounded-lg'>
              <div className='flex space-x-1'>
                <div className='w-2 h-2 bg-gray-400 rounded-full animate-bounce'></div>
                <div
                  className='w-2 h-2 bg-gray-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.1s' }}
                ></div>
                <div
                  className='w-2 h-2 bg-gray-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.2s' }}
                ></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className='p-4 border-t border-gray-200'>
        <div className='flex gap-2'>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='输入消息...'
            className='flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
            rows={1}
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className='px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          >
            <Send className='w-4 h-4' />
          </button>
        </div>
      </div>
    </div>
  )
}
