'use client'

import type React from 'react'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  FileText,
  Database,
  Calendar,
  CheckSquare,
  ImageIcon,
  Code,
  Users,
  Folder,
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
    description: '制定项目目标和里程碑',
    icon: <Calendar className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'task-list',
    title: '任务清单',
    description: '管理待办事项和进度',
    icon: <CheckSquare className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'image-gallery',
    title: '图片库',
    description: '展示和管理图片资源',
    icon: <ImageIcon className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'code-snippet',
    title: '代码片段',
    description: '保存和分享代码示例',
    icon: <Code className='w-5 h-5' />,
    category: '页面',
  },
  {
    id: 'database-schema',
    title: '数据库架构',
    description: '设计和管理数据库结构',
    icon: <Database className='w-5 h-5' />,
    category: '数据库',
  },
  {
    id: 'folder',
    title: '文件夹',
    description: '组织和管理其他页面',
    icon: <Folder className='w-5 h-5' />,
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

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className='w-[400px] sm:w-[540px]'>
        <SheetHeader>
          <SheetTitle className='flex items-center gap-3'>
            <div className='w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center'>
              <Sparkles className='w-4 h-4 text-white' />
            </div>
            创建新内容
          </SheetTitle>
          <SheetDescription>选择模板或从空白页面开始</SheetDescription>
        </SheetHeader>

        <div className='mt-6 space-y-6'>
          {/* Search */}
          <div className='space-y-3'>
            <Input
              placeholder='搜索模板或输入页面标题...'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='w-full'
              autoFocus
            />
            {searchQuery && (
              <Input
                placeholder='自定义页面标题（可选）'
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                className='w-full'
              />
            )}
          </div>

          {/* Options */}
          <div className='space-y-6 max-h-96 overflow-y-auto'>
            {Object.entries(groupedOptions).map(([category, options]) => (
              <div key={category}>
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
                        <h4 className='text-sm font-medium text-gray-900 group-hover:text-blue-600'>
                          {option.title}
                        </h4>
                        <p className='text-sm text-gray-500 mt-1'>
                          {option.description}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
