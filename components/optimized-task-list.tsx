"use client"

import React, { memo, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { Task, TaskStatus, Priority, User, ID } from '@/types'
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '@/constants'
import { dateUtils, stringUtils } from '@/utils'

// ==================== 接口定义 ====================

interface OptimizedTaskListProps {
  tasks: Task[]
  selectedTaskIds: ID[]
  onTaskSelect: (taskId: ID) => void
  onTaskUpdate: (taskId: ID, updates: Partial<Task>) => void
  onTaskDelete: (taskId: ID) => void
  onBulkSelect: (taskIds: ID[]) => void
  loading?: boolean
  error?: string
}

interface TaskItemProps {
  task: Task
  isSelected: boolean
  onSelect: (taskId: ID) => void
  onUpdate: (taskId: ID, updates: Partial<Task>) => void
  onDelete: (taskId: ID) => void
}

// ==================== 任务项组件（使用memo优化） ====================

const TaskItem = memo<TaskItemProps>(({ 
  task, 
  isSelected, 
  onSelect, 
  onUpdate, 
  onDelete 
}) => {
  // 使用useCallback优化事件处理函数
  const handleSelect = useCallback(() => {
    onSelect(task.id)
  }, [task.id, onSelect])

  const handleStatusChange = useCallback((status: TaskStatus) => {
    onUpdate(task.id, { status })
  }, [task.id, onUpdate])

  const handlePriorityChange = useCallback((priority: Priority) => {
    onUpdate(task.id, { priority })
  }, [task.id, onUpdate])

  const handleDelete = useCallback(() => {
    onDelete(task.id)
  }, [task.id, onDelete])

  // 使用useMemo优化计算属性
  const priorityOption = useMemo(() => 
    PRIORITY_OPTIONS.find(opt => opt.value === task.priority),
    [task.priority]
  )

  const statusOption = useMemo(() => 
    STATUS_OPTIONS.task.find(opt => opt.value === task.status),
    [task.status]
  )

  const isOverdue = useMemo(() => {
    if (!task.dueDate) return false
    return new Date(task.dueDate) < new Date() && task.status !== 'done'
  }, [task.dueDate, task.status])

  const timeAgo = useMemo(() => 
    dateUtils.timeAgo(task.updatedAt),
    [task.updatedAt]
  )

  const assigneeInitials = useMemo(() => {
    if (!task.assignee) return '?'
    return task.assignee.name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }, [task.assignee])

  return (
    <Card className={`transition-all duration-200 hover:shadow-md ${
      isSelected ? 'ring-2 ring-blue-500' : ''
    } ${isOverdue ? 'border-red-200 bg-red-50' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <Checkbox
              checked={isSelected}
              onCheckedChange={handleSelect}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-medium line-clamp-2">
                {task.title}
              </CardTitle>
              {task.description && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {task.assignee && (
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {assigneeInitials}
                </AvatarFallback>
              </Avatar>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            >
              ×
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 状态选择 */}
            <select
              value={task.status}
              onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
              className={`text-xs px-2 py-1 rounded border-0 bg-transparent ${
                statusOption?.color || 'bg-gray-100'
              } text-white font-medium`}
            >
              {STATUS_OPTIONS.task.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {/* 优先级选择 */}
            <select
              value={task.priority}
              onChange={(e) => handlePriorityChange(e.target.value as Priority)}
              className={`text-xs px-2 py-1 rounded border-0 bg-transparent ${
                priorityOption?.color || 'bg-gray-100'
              } text-white font-medium`}
            >
              {PRIORITY_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.icon} {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {task.dueDate && (
              <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                {dateUtils.format(task.dueDate, 'MM-DD')}
              </span>
            )}
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* 标签 */}
        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {task.tags.map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* 时间估算 */}
        {(task.estimatedHours || task.actualHours) && (
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            {task.estimatedHours && (
              <span>预估: {task.estimatedHours}h</span>
            )}
            {task.actualHours && (
              <span>实际: {task.actualHours}h</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
})

TaskItem.displayName = 'TaskItem'

// ==================== 主列表组件 ====================

export const OptimizedTaskList = memo<OptimizedTaskListProps>(({
  tasks,
  selectedTaskIds,
  onTaskSelect,
  onTaskUpdate,
  onTaskDelete,
  onBulkSelect,
  loading = false,
  error
}) => {
  // 使用useMemo优化选中状态计算
  const selectedTaskSet = useMemo(() => 
    new Set(selectedTaskIds),
    [selectedTaskIds]
  )

  // 使用useCallback优化批量选择
  const handleSelectAll = useCallback(() => {
    if (selectedTaskIds.length === tasks.length) {
      onBulkSelect([])
    } else {
      onBulkSelect(tasks.map(task => task.id))
    }
  }, [selectedTaskIds.length, tasks.length, tasks, onBulkSelect])

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
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="animate-pulse">
            <CardHeader>
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            </CardHeader>
            <CardContent>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  // 错误状态
  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <p className="text-red-600 text-center">{error}</p>
        </CardContent>
      </Card>
    )
  }

  // 空状态
  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">暂无任务</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* 统计信息和批量操作 */}
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-4 text-sm">
          <span>总计: {statistics.total}</span>
          <span>已完成: {statistics.completed}</span>
          <span className={statistics.overdue > 0 ? 'text-red-600' : ''}>
            逾期: {statistics.overdue}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <Checkbox
            checked={statistics.selected === statistics.total && statistics.total > 0}
            onCheckedChange={handleSelectAll}
          />
          <span className="text-sm text-muted-foreground">
            {statistics.selected > 0 && `已选择 ${statistics.selected} 项`}
          </span>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="space-y-3">
        {tasks.map(task => (
          <TaskItem
            key={task.id}
            task={task}
            isSelected={selectedTaskSet.has(task.id)}
            onSelect={onTaskSelect}
            onUpdate={onTaskUpdate}
            onDelete={onTaskDelete}
          />
        ))}
      </div>
    </div>
  )
})

OptimizedTaskList.displayName = 'OptimizedTaskList'

export default OptimizedTaskList
