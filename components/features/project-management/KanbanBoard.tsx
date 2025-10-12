'use client'
import { useState } from 'react'
import type React from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface KanbanItem {
  id: string
  title: string
  status: string
  priority?: string
  assignee?: string | undefined
  dueDate?: string | undefined
  updatedAt: string
  type: 'prd' | 'epic' | 'story' | 'task'
  content?: string
}

interface KanbanBoardProps {
  items: KanbanItem[]
  onStatusChange: (itemId: string, newStatus: string) => void
  type: 'project' | 'prd' | 'epic' | 'story'
}

const statusColumns = {
  project: [
    { id: 'backlog', title: '待办', color: 'bg-gray-100' },
    { id: 'planning', title: '规划中', color: 'bg-blue-100' },
    { id: 'in-progress', title: '进行中', color: 'bg-yellow-100' },
    { id: 'done', title: '已完成', color: 'bg-green-100' },
  ],
  prd: [
    { id: 'draft', title: '草稿', color: 'bg-gray-100' },
    { id: 'review', title: '评审中', color: 'bg-yellow-100' },
    { id: 'approved', title: '已批准', color: 'bg-green-100' },
  ],
  epic: [
    { id: 'backlog', title: '待办', color: 'bg-gray-100' },
    { id: 'planning', title: '规划中', color: 'bg-blue-100' },
    { id: 'in-progress', title: '进行中', color: 'bg-yellow-100' },
    { id: 'done', title: '已完成', color: 'bg-green-100' },
  ],
  story: [
    { id: 'todo', title: '待办', color: 'bg-gray-100' },
    { id: 'in-progress', title: '进行中', color: 'bg-yellow-100' },
    { id: 'done', title: '已完成', color: 'bg-green-100' },
  ],
}

export default function KanbanBoard({
  items,
  onStatusChange,
  type,
}: KanbanBoardProps) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [draggedOver, setDraggedOver] = useState<string | null>(null)

  const columns = statusColumns[type]

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDraggedOver(columnId)
  }

  const handleDragLeave = () => {
    setDraggedOver(null)
  }

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    if (draggedItem) {
      onStatusChange(draggedItem, newStatus)
      setDraggedItem(null)
      setDraggedOver(null)
    }
  }

  const getItemsByStatus = (status: string) => {
    return items.filter(item => item.status === status)
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800'
      case 'low':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityLabel = (priority?: string) => {
    switch (priority) {
      case 'high':
        return '高'
      case 'medium':
        return '中'
      case 'low':
        return '低'
      default:
        return ''
    }
  }

  const getProgressStats = () => {
    const total = items.length
    const completed = items.filter(
      item => item.status === 'done' || item.status === 'approved'
    ).length
    const inProgress = items.filter(
      item => item.status === 'in-progress' || item.status === 'review'
    ).length
    const todo = total - completed - inProgress
    const progress = total > 0 ? (completed / total) * 100 : 0

    return { total, completed, inProgress, todo, progress }
  }

  const stats = getProgressStats()

  const generateAISummary = () => {
    const { total, completed, inProgress, todo, progress } = stats

    if (total === 0) {
      return '暂无任务数据，建议开始创建项目任务。'
    }

    let summary = `当前共有 ${total} 个任务，`

    if (completed > 0) {
      summary += `${completed} 个已完成，`
    }

    if (inProgress > 0) {
      summary += `${inProgress} 个进行中，`
    }

    if (todo > 0) {
      summary += `${todo} 个未开始，`
    }

    summary += `整体完成度 ${Math.round(progress)}%。`

    // Add AI insights based on progress
    if (progress >= 80) {
      summary += ' 🎉 项目进展顺利，即将完成！'
    } else if (progress >= 60) {
      summary += ' 📈 项目进展良好，保持当前节奏。'
    } else if (progress >= 40) {
      summary += ' ⚡ 建议加快进度，关注进行中的任务。'
    } else if (progress >= 20) {
      summary += ' 🔔 项目进度较慢，建议优化资源分配。'
    } else {
      summary += ' 🚀 项目刚刚开始，建议制定详细的执行计划。'
    }

    return summary
  }

  return (
    <div className='h-full flex flex-col'>
      {/* AI Progress Summary */}
      <div className='mb-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200'>
        <div className='flex items-center gap-2 mb-2'>
          <span className='text-blue-600'>🧠</span>
          <h3 className='text-lg font-semibold text-blue-900'>AI 进度总结</h3>
          <span className='text-blue-600'>📈</span>
        </div>
        <p className='text-sm text-blue-800 leading-relaxed'>
          {generateAISummary()}
        </p>
      </div>

      {/* Progress Header */}
      <div className='mb-6 p-4 bg-gray-50 rounded-lg'>
        <div className='flex items-center justify-between mb-3'>
          <h3 className='text-lg font-semibold text-gray-900'>项目进度</h3>
          <div className='flex items-center gap-4 text-sm text-gray-600'>
            <div className='flex items-center gap-1'>
              <span className='text-green-600'>✅</span>
              <span>已完成: {stats.completed}</span>
            </div>
            <div className='flex items-center gap-1'>
              <span className='text-yellow-600'>⏰</span>
              <span>进行中: {stats.inProgress}</span>
            </div>
            <div className='flex items-center gap-1'>
              <span className='text-gray-600'>⚠️</span>
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
      <div className='flex-1 flex gap-6 overflow-x-auto pb-4'>
        {columns.map(column => (
          <div key={column.id} className='flex-shrink-0 w-80'>
            <div className={`${column.color} rounded-lg p-3 mb-4`}>
              <h3 className='font-semibold text-gray-900 flex items-center justify-between'>
                {column.title}
                <Badge variant='secondary' className='bg-white/50'>
                  {getItemsByStatus(column.id).length}
                </Badge>
              </h3>
            </div>

            <div
              className={`min-h-[200px] space-y-3 p-2 rounded-lg transition-colors ${
                draggedOver === column.id
                  ? 'bg-blue-50 border-2 border-blue-300'
                  : 'bg-gray-50'
              }`}
              onDragOver={e => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, column.id)}
            >
              {getItemsByStatus(column.id).map(item => (
                <Card
                  key={item.id}
                  draggable
                  onDragStart={e => handleDragStart(e, item.id)}
                  className={`cursor-grab active:cursor-grabbing transition-all ${
                    draggedItem === item.id
                      ? 'opacity-50 scale-95'
                      : 'shadow-sm hover:shadow-md'
                  }`}
                >
                  <CardHeader className='pb-2'>
                    <CardTitle className='text-sm font-medium text-gray-900 line-clamp-2'>
                      {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='pt-0'>
                    {item.content && (
                      <p className='text-xs text-gray-600 mb-3 line-clamp-2'>
                        {item.content}
                      </p>
                    )}

                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        {item.priority && (
                          <Badge
                            className={`text-xs ${getPriorityColor(item.priority)} border-0`}
                          >
                            {getPriorityLabel(item.priority)}
                          </Badge>
                        )}
                        <Badge variant='outline' className='text-xs'>
                          {item.type.toUpperCase()}
                        </Badge>
                      </div>

                      <div className='flex items-center gap-2 text-xs text-gray-500'>
                        {item.assignee && (
                          <div className='flex items-center gap-1'>
                            <span>👤</span>
                            <span>{item.assignee}</span>
                          </div>
                        )}
                        {item.dueDate && (
                          <div className='flex items-center gap-1'>
                            <span>📅</span>
                            <span>
                              {new Date(item.dueDate).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className='mt-2 text-xs text-gray-400'>
                      更新: {new Date(item.updatedAt).toLocaleDateString()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
