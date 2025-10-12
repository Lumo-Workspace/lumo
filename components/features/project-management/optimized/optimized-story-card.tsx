/**
 * 优化的故事卡片组件
 * Optimized Story Card Component
 */

'use client'

import React, { memo, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { Calendar, Clock, CheckCircle2, Edit, Trash2, Copy } from 'lucide-react'
import { cn, formatDate, formatRelativeTime } from '@/utils'
import { PRIORITY_COLORS, STATUS_COLORS } from '@/constants'
import type { Story, Priority, StoryStatus } from '@/types'

interface StoryCardProps {
  story: Story
  onEdit?: (story: Story) => void
  onDelete?: (story: Story) => void
  onDuplicate?: (story: Story) => void
  onStatusChange?: (story: Story, status: StoryStatus) => void
  onPriorityChange?: (story: Story, priority: Priority) => void
  onAssigneeChange?: (story: Story, assignee: string) => void
  className?: string
  compact?: boolean
  showActions?: boolean
  interactive?: boolean
}

// 优化后的故事卡片组件
export const OptimizedStoryCard = memo<StoryCardProps>(
  ({
    story,
    onEdit,
    onDelete,
    onDuplicate,
    className,
    compact = false,
    showActions = true,
    interactive = true,
  }) => {
    // 计算属性 - 使用 useMemo 避免不必要的重新计算
    const priorityColor = useMemo(
      () =>
        PRIORITY_COLORS[
          story.priority.toUpperCase() as keyof typeof PRIORITY_COLORS
        ],
      [story.priority]
    )

    const statusColor = useMemo(
      () =>
        STATUS_COLORS[story.status.toUpperCase() as keyof typeof STATUS_COLORS],
      [story.status]
    )

    const progress = useMemo(() => {
      if (story.actualPoints && story.estimatedPoints) {
        return Math.min((story.actualPoints / story.estimatedPoints) * 100, 100)
      }
      return 0
    }, [story.actualPoints, story.estimatedPoints])

    const isOverdue = useMemo(() => {
      // 这里可以添加截止日期逻辑
      return false
    }, [])

    const assigneeInitials = useMemo(() => {
      if (!story.assignee) return ''
      return story.assignee
        .split(' ')
        .map(name => name[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }, [story.assignee])

    // 事件处理器 - 使用 useCallback 避免不必要的重新渲染
    const handleEdit = useCallback(() => {
      onEdit?.(story)
    }, [onEdit, story])

    const handleDelete = useCallback(() => {
      onDelete?.(story)
    }, [onDelete, story])

    const handleDuplicate = useCallback(() => {
      onDuplicate?.(story)
    }, [onDuplicate, story])

    // 渲染状态指示器
    const renderStatusIndicator = () => (
      <div className='flex items-center gap-2'>
        <div
          className='w-2 h-2 rounded-full'
          style={{ backgroundColor: statusColor }}
        />
        <span className='text-sm font-medium capitalize'>
          {story.status.replace('_', ' ')}
        </span>
      </div>
    )

    // 渲染优先级徽章
    const renderPriorityBadge = () => (
      <Badge
        variant='outline'
        className='text-xs'
        style={{
          borderColor: priorityColor,
          color: priorityColor,
        }}
      >
        {story.priority}
      </Badge>
    )

    // 渲染标签
    const renderTags = () => {
      if (!story.tags?.length) return null

      return (
        <div className='flex flex-wrap gap-1'>
          {story.tags.slice(0, 3).map((tag, index) => (
            <Badge key={index} variant='secondary' className='text-xs'>
              {tag}
            </Badge>
          ))}
          {story.tags.length > 3 && (
            <Badge variant='secondary' className='text-xs'>
              +{story.tags.length - 3}
            </Badge>
          )}
        </div>
      )
    }

    // 渲染验收标准
    const renderAcceptanceCriteria = () => {
      if (!story.acceptanceCriteria?.length || compact) return null

      return (
        <div className='space-y-1'>
          <h4 className='text-xs font-medium text-gray-600'>验收标准:</h4>
          <ul className='text-xs text-gray-500 space-y-1'>
            {story.acceptanceCriteria.slice(0, 2).map((criteria, index) => (
              <li key={index} className='flex items-start gap-1'>
                <CheckCircle2 className='h-3 w-3 mt-0.5 text-green-500 flex-shrink-0' />
                <span className='line-clamp-2'>{criteria}</span>
              </li>
            ))}
            {story.acceptanceCriteria.length > 2 && (
              <li className='text-xs text-gray-400'>
                +{story.acceptanceCriteria.length - 2} 更多...
              </li>
            )}
          </ul>
        </div>
      )
    }

    // 渲染操作按钮
    const renderActions = () => {
      if (!showActions) return null

      return (
        <div className='flex items-center gap-1'>
          <Button
            size='sm'
            variant='ghost'
            onClick={handleEdit}
            className='h-8 w-8 p-0'
          >
            <Edit className='h-4 w-4' />
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={handleDuplicate}
            className='h-8 w-8 p-0'
          >
            <Copy className='h-4 w-4' />
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={handleDelete}
            className='h-8 w-8 p-0 text-red-600 hover:text-red-700'
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      )
    }

    // 渲染进度条
    const renderProgress = () => {
      if (!story.estimatedPoints) return null

      return (
        <div className='space-y-2'>
          <div className='flex items-center justify-between text-xs'>
            <span>进度</span>
            <span className='font-medium'>
              {story.actualPoints || 0} / {story.estimatedPoints} 点
            </span>
          </div>
          <Progress value={progress} className='h-1' />
        </div>
      )
    }

    // 渲染元数据
    const renderMetadata = () => (
      <div className='flex items-center gap-4 text-xs text-gray-500'>
        <div className='flex items-center gap-1'>
          <Calendar className='h-3 w-3' />
          <span>{formatDate(story.createdAt)}</span>
        </div>
        <div className='flex items-center gap-1'>
          <Clock className='h-3 w-3' />
          <span>{formatRelativeTime(story.updatedAt)}</span>
        </div>
        {story.assignee && (
          <div className='flex items-center gap-1'>
            <Avatar className='h-4 w-4'>
              <AvatarFallback className='text-xs'>
                {assigneeInitials}
              </AvatarFallback>
            </Avatar>
            <span className='truncate max-w-20'>{story.assignee}</span>
          </div>
        )}
      </div>
    )

    return (
      <Card
        className={cn(
          'transition-all duration-200',
          interactive && 'hover:shadow-md cursor-pointer',
          isOverdue && 'border-red-200 bg-red-50',
          compact && 'p-3',
          className
        )}
      >
        <CardHeader className={cn('space-y-3', compact && 'p-3 pb-2')}>
          <div className='flex items-start justify-between'>
            <div className='flex-1 min-w-0'>
              <CardTitle
                className={cn(
                  'text-sm font-semibold leading-tight',
                  compact && 'text-xs'
                )}
              >
                {story.title}
              </CardTitle>
              <div className='mt-1 flex items-center gap-2'>
                {renderPriorityBadge()}
                {renderStatusIndicator()}
              </div>
            </div>
            {renderActions()}
          </div>

          {story.businessValue && !compact && (
            <div className='text-xs text-gray-600 bg-blue-50 p-2 rounded'>
              <strong>业务价值:</strong> {story.businessValue}
            </div>
          )}
        </CardHeader>

        <CardContent className={cn('space-y-3', compact && 'p-3 pt-0')}>
          {/* 用户故事描述 */}
          {!compact && (
            <div className='space-y-2'>
              <div className='text-xs'>
                <span className='font-medium'>作为</span> {story.asA}
              </div>
              <div className='text-xs'>
                <span className='font-medium'>我希望</span> {story.iWant}
              </div>
              <div className='text-xs'>
                <span className='font-medium'>以便</span> {story.soThat}
              </div>
            </div>
          )}

          {/* 验收标准 */}
          {renderAcceptanceCriteria()}

          {/* 标签 */}
          {renderTags()}

          {/* 进度条 */}
          {renderProgress()}

          {/* 元数据 */}
          {renderMetadata()}
        </CardContent>
      </Card>
    )
  }
)

OptimizedStoryCard.displayName = 'OptimizedStoryCard'

// 导出默认组件
export default OptimizedStoryCard
