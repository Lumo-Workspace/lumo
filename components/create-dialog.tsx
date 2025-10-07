'use client'

import type React from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  FileText,
  Database,
  Calendar,
  CheckSquare,
  ImageIcon,
  Code,
  Users,
  Folder,
  X,
  Sparkles,
} from 'lucide-react'

interface CreateOption {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  category: '页面' | '数据库' | '其他'
}

interface CreateDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreatePage: (type: string, title?: string) => void
}

const createOptions: CreateOption[] = [
  {
    id: 'blank-page',
    title: '空白页面',
    description: '开始写作或记录想法',
    icon: <FileText className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'meeting-notes',
    title: '会议记录',
    description: '记录会议要点和行动项',
    icon: <Users className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'project-plan',
    title: '项目计划',
    description: '规划项目时间线和任务',
    icon: <Calendar className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'task-list',
    title: '任务清单',
    description: '创建待办事项列表',
    icon: <CheckSquare className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'database',
    title: '数据库',
    description: '结构化存储和管理信息',
    icon: <Database className='w-5 h-5' />,
    category: '数据库',
  },
  {
    id: 'gallery',
    title: '图片库',
    description: '展示图片和媒体内容',
    icon: <ImageIcon className='w-5 h-5' />,
    category: '其他',
  },
  {
    id: 'code-snippet',
    title: '代码片段',
    description: '保存和分享代码',
    icon: <Code className='w-5 h-5' />,
    category: '其他',
  },
]

export default function CreateDialog({
  isOpen,
  onClose,
  onCreatePage,
}: CreateDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [customTitle, setCustomTitle] = useState('')

  if (!isOpen) return null

  const filteredOptions = createOptions.filter(
    option =>
      option.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      option.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const groupedOptions = filteredOptions.reduce(
    (acc, option) => {
      if (!acc[option.category]) {
        acc[option.category] = []
      }
      acc[option.category]!.push(option)
      return acc
    },
    {} as Record<string, CreateOption[]>
  )

  const handleCreatePage = (optionId: string) => {
    onCreatePage(optionId, customTitle || undefined)
    setCustomTitle('')
    setSearchQuery('')
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'
      onClick={onClose}
    >
      <div
        className='bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden'
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className='flex items-center justify-between p-6 border-b border-gray-200'>
          <div className='flex items-center gap-3'>
            <div className='w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center'>
              <Sparkles className='w-4 h-4 text-white' />
            </div>
            <div>
              <h2 className='text-xl font-semibold text-gray-900'>
                创建新内容
              </h2>
              <p className='text-sm text-gray-600'>选择模板或从空白页面开始</p>
            </div>
          </div>
          <Button variant='ghost' size='sm' onClick={onClose}>
            <X className='w-4 h-4' />
          </Button>
        </div>

        {/* Search */}
        <div className='p-6 border-b border-gray-200'>
          <Input
            placeholder='搜索模板或输入页面标题...'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className='w-full'
            autoFocus
          />
          {searchQuery && (
            <div className='mt-3'>
              <Input
                placeholder='自定义页面标题（可选）'
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                className='w-full'
              />
            </div>
          )}
        </div>

        {/* Options */}
        <div className='p-6 overflow-y-auto max-h-96'>
          {Object.entries(groupedOptions).map(([category, options]) => (
            <div key={category} className='mb-6 last:mb-0'>
              <h3 className='text-sm font-medium text-gray-500 mb-3 uppercase tracking-wide'>
                {category}
              </h3>
              <div className='grid grid-cols-1 gap-2'>
                {options.map(option => (
                  <button
                    key={option.id}
                    onClick={() => handleCreatePage(option.id)}
                    className='flex items-center gap-4 p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 text-left group'
                  >
                    <div className='flex-shrink-0 w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-blue-100 transition-colors'>
                      <div className='text-gray-600 group-hover:text-blue-600'>
                        {option.icon}
                      </div>
                    </div>
                    <div className='flex-1 min-w-0'>
                      <h4 className='font-medium text-gray-900 group-hover:text-blue-900'>
                        {option.title}
                      </h4>
                      <p className='text-sm text-gray-600 group-hover:text-blue-700'>
                        {option.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {filteredOptions.length === 0 && (
            <div className='text-center py-12'>
              <Folder className='w-12 h-12 text-gray-400 mx-auto mb-4' />
              <h3 className='text-lg font-medium text-gray-900 mb-2'>
                未找到匹配的模板
              </h3>
              <p className='text-gray-600 mb-4'>
                试试其他关键词，或创建空白页面
              </p>
              <Button onClick={() => handleCreatePage('blank-page')}>
                <FileText className='w-4 h-4 mr-2' />
                创建空白页面
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
