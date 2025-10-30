'use client'

import { memo, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import type { Task } from '@/types'

// ==================== 接口定义 ====================

interface OptimizedTaskListProps {
  tasks: Task[]
  selectedTaskIds: string[]
  onTaskSelect: (taskId: string) => void
  loading?: boolean
  error?: string
}

interface TaskItemProps {
  task: Task
  isSelected: boolean
  onSelect: (taskId: string) => void
  onUpdate: (taskId: string, updates: Partial<Task>) => void
  onDelete: (taskId: string) => void
}

// ==================== 任务项组件（使用memo优化） ====================

const TaskItem = memo<TaskItemProps>(({ task, isSelected }) => {
  // 使用useMemo优化计算属性
  const priorityOption = useMemo(() => {
    const priorityMap: Record<string, { label: string; color: string }> = {
      low: { label: 'Low', color: 'text-green-600' },
      medium: { label: 'Medium', color: 'text-yellow-600' },
      high: { label: 'High', color: 'text-orange-600' },
      critical: { label: 'Critical', color: 'text-red-600' },
    }
    return (
      priorityMap[task.priority] || { label: 'Unknown', color: 'text-gray-600' }
    )
  }, [task.priority])

  const statusOption = useMemo(() => {
    const statusMap: Record<string, { label: string; color: string }> = {
      todo: { label: 'To Do', color: 'text-gray-600' },
      'in-progress': { label: 'In Progress', color: 'text-blue-600' },
      done: { label: 'Done', color: 'text-green-600' },
    }
    return (
      statusMap[task.status] || { label: 'Unknown', color: 'text-gray-600' }
    )
  }, [task.status])

  const isOverdue = useMemo(() => {
    if (!task.dueDate) return false
    return new Date(task.dueDate) < new Date() && task.status !== 'done'
  }, [task.dueDate, task.status])

  const timeAgo = useMemo(() => {
    const now = new Date()
    const updatedAt = new Date(task.updatedAt)
    const diffInMs = now.getTime() - updatedAt.getTime()
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

    if (diffInDays === 0) return 'Today'
    if (diffInDays === 1) return 'Yesterday'
    if (diffInDays < 7) return `${diffInDays} days ago`
    if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`
    return `${Math.floor(diffInDays / 30)} months ago`
  }, [task.updatedAt])

  const assigneeInitials = useMemo(() => {
    if (!task.assignee) return '?'
    return task.assignee
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }, [task.assignee])

  return (
    <Card
      className={`transition-all duration-200 hover:shadow-md ${
        isSelected ? 'ring-2 ring-blue-500' : ''
      } ${isOverdue ? 'border-red-200 bg-red-50' : ''}`}
    >
      <CardHeader className='pb-3'>
        <div className='flex items-start justify-between'>
          <div className='flex items-start gap-3 flex-1'>
            <div className='w-4 h-4 mt-1' />
            <div className='flex-1 min-w-0'>
              <CardTitle className='text-base font-medium line-clamp-2'>
                {task.title}
              </CardTitle>
              {task.description && (
                <p className='text-sm text-muted-foreground mt-1 line-clamp-2'>
                  {task.description}
                </p>
              )}
            </div>
          </div>

          <div className='flex items-center gap-2'>
            {task.assignee && (
              <Avatar className='h-8 w-8'>
                <AvatarFallback className='text-xs'>
                  {assigneeInitials}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className='pt-0'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            {/* 状态显示 */}
            <Badge
              variant='secondary'
              className={`text-xs ${statusOption?.color || 'bg-gray-100 text-gray-600'}`}
            >
              {statusOption?.label || task.status}
            </Badge>

            {/* 优先级显示 */}
            <Badge
              variant='outline'
              className={`text-xs ${priorityOption?.color || 'bg-gray-100 text-gray-600'}`}
            >
              {priorityOption?.label || task.priority}
            </Badge>
          </div>

          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            {task.dueDate && (
              <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                {new Date(task.dueDate).toLocaleDateString('en-US', {
                  month: '2-digit',
                  day: '2-digit',
                })}
              </span>
            )}
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* 标签 */}
        {task.tags.length > 0 && (
          <div className='flex flex-wrap gap-1 mt-3'>
            {task.tags.map(tag => (
              <Badge key={tag} variant='secondary' className='text-xs'>
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* 时间估算 */}
        {(task.estimatedHours || task.actualHours) && (
          <div className='flex items-center gap-4 mt-3 text-xs text-muted-foreground'>
            {task.estimatedHours && <span>预估: {task.estimatedHours}h</span>}
            {task.actualHours && <span>实际: {task.actualHours}h</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
})

TaskItem.displayName = 'TaskItem'

// ==================== 主列表组件 ====================

export const OptimizedTaskList = memo<OptimizedTaskListProps>(
  ({ tasks, selectedTaskIds, onTaskSelect, loading = false, error }) => {
    // 使用useMemo优化选中状态计算
    const selectedTaskSet = useMemo(
      () => new Set(selectedTaskIds),
      [selectedTaskIds]
    )

    // 使用useMemo优化统计信息
    const statistics = useMemo(() => {
      const total = tasks.length
      const selected = selectedTaskIds.length
      const completed = tasks.filter(task => task.status === 'done').length
      const overdue = tasks.filter(task => {
        if (!task.dueDate) return false
        return new Date(task.dueDate) < new Date() && task.status !== 'done'
      }).length

      return { total, selected, completed, overdue }
    }, [tasks, selectedTaskIds])

    // 加载状态
    if (loading) {
      return (
        <div className='space-y-4'>
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className='animate-pulse'>
              <CardHeader>
                <div className='h-4 bg-gray-200 rounded w-3/4'></div>
              </CardHeader>
              <CardContent>
                <div className='h-3 bg-gray-200 rounded w-1/2'></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )
    }

    // 错误状态
    if (error) {
      return (
        <Card className='border-red-200 bg-red-50'>
          <CardContent className='pt-6'>
            <p className='text-red-600 text-center'>{error}</p>
          </CardContent>
        </Card>
      )
    }

    // 空状态
    if (tasks.length === 0) {
      return (
        <Card>
          <CardContent className='pt-6'>
            <p className='text-center text-muted-foreground'>暂无任务</p>
          </CardContent>
        </Card>
      )
    }

    return (
      <div className='space-y-4'>
        {/* 统计信息和批量操作 */}
        <div className='flex items-center justify-between p-4 bg-muted/50 rounded-lg'>
          <div className='flex items-center gap-4 text-sm'>
            <span>总计: {statistics.total}</span>
            <span>已完成: {statistics.completed}</span>
            <span className={statistics.overdue > 0 ? 'text-red-600' : ''}>
              逾期: {statistics.overdue}
            </span>
          </div>

          <div className='flex items-center gap-2'>
            <div className='w-4 h-4' />
            <span className='text-sm text-muted-foreground'>
              {statistics.selected > 0 && `已选择 ${statistics.selected} 项`}
            </span>
          </div>
        </div>

        {/* 任务列表 */}
        <Card>
          <CardHeader>
            <CardTitle>任务列表</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-12'>选择</TableHead>
                  <TableHead>任务</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>优先级</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>截止日期</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map(task => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedTaskSet.has(task.id)}
                        onCheckedChange={() => onTaskSelect(task.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className='space-y-1'>
                        <div className='font-medium'>{task.title}</div>
                        {task.description && (
                          <div className='text-sm text-gray-500'>
                            {task.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-xs'>
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-xs'>
                        {task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {task.assignee ? (
                        <div className='flex items-center gap-2'>
                          <Avatar className='w-6 h-6'>
                            <AvatarFallback className='text-xs'>
                              {task.assignee.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className='text-sm'>{task.assignee}</span>
                        </div>
                      ) : (
                        <span className='text-sm text-gray-400'>未分配</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {task.dueDate ? (
                        <span className='text-sm'>
                          {new Date(task.dueDate).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className='text-sm text-gray-400'>
                          无截止日期
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    )
  }
)

OptimizedTaskList.displayName = 'OptimizedTaskList'

export default OptimizedTaskList
