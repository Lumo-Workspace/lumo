'use client'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Toggle } from '@/components/ui/toggle'
import { Button } from '@/components/ui/button'

interface KanbanItem {
  id: string
  title: string
  status: string
  priority?: string
  assignee?: string
  content?: string
}

const initialItems: KanbanItem[] = [
  {
    id: 'prd-1',
    title: '用户认证系统 PRD',
    status: 'approved',
    content:
      '用户认证系统的产品需求文档，包含登录、注册、密码重置等功能的详细说明...',
  },
  {
    id: 'prd-2',
    title: '用户个人中心 PRD',
    status: 'draft',
    content: '用户个人中心功能的产品需求文档，包含个人信息管理、设置等功能...',
  },
  {
    id: 'prd-3',
    title: '消息通知系统 PRD',
    status: 'review',
    content: '消息通知系统的产品需求文档，包含站内信、推送通知等功能...',
  },
  {
    id: 'prd-4',
    title: '数据分析平台 PRD',
    status: 'draft',
    content: '数据分析平台的产品需求文档，包含数据可视化、报表生成等功能...',
  },
]

const statusColumns = [
  { id: 'draft', title: '草稿', color: 'bg-gray-100' },
  { id: 'review', title: '评审中', color: 'bg-yellow-100' },
  { id: 'approved', title: '已批准', color: 'bg-green-100' },
]

export default function TestKanbanPage() {
  const [items, setItems] = useState<KanbanItem[]>(initialItems)
  const [viewMode, setViewMode] = useState<'document' | 'kanban'>('kanban')

  const handleStatusChange = (itemId: string, newStatus: string) => {
    setItems(prev =>
      prev.map(item =>
        item.id === itemId ? { ...item, status: newStatus } : item
      )
    )
  }

  const getItemsByStatus = (status: string) => {
    return items.filter(item => item.status === status)
  }

  const getProgressStats = () => {
    const total = items.length
    const completed = items.filter(item => item.status === 'approved').length
    const inProgress = items.filter(item => item.status === 'review').length
    const progress = total > 0 ? (completed / total) * 100 : 0

    return { total, completed, inProgress, progress }
  }

  const stats = getProgressStats()

  if (viewMode === 'document') {
    return (
      <div className='p-6'>
        <div className='flex items-center justify-between mb-6'>
          <h1 className='text-2xl font-bold'>文档模式</h1>
          <div className='flex items-center gap-2'>
            <Toggle
              pressed={viewMode === 'document'}
              onPressedChange={() => setViewMode('document')}
              size='sm'
            >
              📄 文档模式
            </Toggle>
            <Toggle
              pressed={false}
              onPressedChange={() => setViewMode('kanban')}
              size='sm'
            >
              📋 看板模式
            </Toggle>
          </div>
        </div>

        <div className='space-y-4'>
          {items.map(item => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className='flex items-center justify-between'>
                  {item.title}
                  <Badge variant='outline'>{item.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className='text-gray-600 mb-4'>{item.content}</p>
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => handleStatusChange(item.id, 'draft')}
                    disabled={item.status === 'draft'}
                  >
                    草稿
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => handleStatusChange(item.id, 'review')}
                    disabled={item.status === 'review'}
                  >
                    评审中
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => handleStatusChange(item.id, 'approved')}
                    disabled={item.status === 'approved'}
                  >
                    已批准
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className='p-6 h-screen'>
      <div className='flex items-center justify-between mb-6'>
        <h1 className='text-2xl font-bold'>看板测试页面</h1>
        <div className='flex items-center gap-2'>
          <Toggle
            pressed={false}
            onPressedChange={() => setViewMode('document')}
            size='sm'
          >
            📄 文档模式
          </Toggle>
          <Toggle
            pressed={viewMode === 'kanban'}
            onPressedChange={() => setViewMode('kanban')}
            size='sm'
          >
            📋 看板模式
          </Toggle>
        </div>
      </div>

      {/* Progress Header */}
      <div className='mb-6 p-4 bg-gray-50 rounded-lg'>
        <div className='flex items-center justify-between mb-3'>
          <h3 className='text-lg font-semibold text-gray-900'>项目进度</h3>
          <div className='flex items-center gap-4 text-sm text-gray-600'>
            <div className='flex items-center gap-1'>
              <span className='w-2 h-2 bg-green-500 rounded-full'></span>
              <span>已完成: {stats.completed}</span>
            </div>
            <div className='flex items-center gap-1'>
              <span className='w-2 h-2 bg-yellow-500 rounded-full'></span>
              <span>进行中: {stats.inProgress}</span>
            </div>
            <div className='flex items-center gap-1'>
              <span className='w-2 h-2 bg-gray-500 rounded-full'></span>
              <span>总计: {stats.total}</span>
            </div>
          </div>
        </div>
        <div className='flex items-center gap-3'>
          <Progress value={stats.progress} className='flex-1' />
          <span className='text-sm font-medium text-gray-900'>
            {Math.round(stats.progress)}%
          </span>
        </div>
      </div>

      {/* Kanban Board */}
      <div className='flex gap-6 overflow-x-auto pb-4'>
        {statusColumns.map(column => (
          <div key={column.id} className='flex-shrink-0 w-80'>
            <div className={`${column.color} rounded-lg p-3 mb-4`}>
              <h3 className='font-semibold text-gray-900 flex items-center justify-between'>
                {column.title}
                <Badge variant='secondary' className='bg-white/50'>
                  {getItemsByStatus(column.id).length}
                </Badge>
              </h3>
            </div>

            <div className='min-h-[200px] space-y-3 p-2 rounded-lg bg-gray-50'>
              {getItemsByStatus(column.id).map(item => (
                <Card
                  key={item.id}
                  className='shadow-sm hover:shadow-md transition-shadow'
                >
                  <CardHeader className='pb-2'>
                    <CardTitle className='text-sm font-medium text-gray-900'>
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='pt-0'>
                    {item.content && (
                      <p className='text-xs text-gray-600 mb-3 line-clamp-2'>
                        {item.content.substring(0, 80)}...
                      </p>
                    )}

                    <div className='flex items-center justify-between mb-3'>
                      <Badge variant='outline' className='text-xs'>
                        PRD
                      </Badge>
                      <div className='text-xs text-gray-400'>更新: 今天</div>
                    </div>

                    {/* Status change buttons */}
                    <div className='flex gap-1'>
                      {statusColumns.map(status => (
                        <Button
                          key={status.id}
                          size='sm'
                          variant={
                            item.status === status.id ? 'default' : 'outline'
                          }
                          className='text-xs px-2 py-1 h-6'
                          onClick={() => handleStatusChange(item.id, status.id)}
                          disabled={item.status === status.id}
                        >
                          {status.title}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className='mt-6 p-4 bg-blue-50 rounded-lg'>
        <h4 className='font-semibold text-blue-900 mb-2'>💡 功能说明</h4>
        <ul className='text-sm text-blue-800 space-y-1'>
          <li>• 点击右上角切换按钮可以在文档模式和看板模式之间切换</li>
          <li>• 在看板模式下，可以点击卡片底部的状态按钮来更改状态</li>
          <li>• 进度条会实时显示项目完成情况</li>
          <li>• 每个列显示对应状态的项目数量</li>
        </ul>
      </div>
    </div>
  )
}
