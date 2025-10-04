"use client"

import { useState, useCallback, useMemo } from "react"
import type { Task, TaskStatus, Priority, User, ID } from "@/types"
import { DEFAULT_VALUES } from "@/constants"
import { stringUtils, dateUtils } from "@/utils"

// ==================== 任务管理状态 ====================

interface TaskManagementState {
  tasks: Record<ID, Task>
  selectedTaskId: ID | null
  filterStatus: TaskStatus | null
  filterPriority: Priority | null
  filterAssignee: ID | null
  searchQuery: string
  sortBy: keyof Task
  sortOrder: 'asc' | 'desc'
  viewMode: 'list' | 'kanban' | 'calendar'
}

// ==================== 任务操作接口 ====================

interface TaskOperations {
  // 基本操作
  createTask: (taskData: Partial<Task>) => Task
  updateTask: (taskId: ID, updates: Partial<Task>) => Task | null
  deleteTask: (taskId: ID) => boolean
  duplicateTask: (taskId: ID) => Task | null
  
  // 状态操作
  updateTaskStatus: (taskId: ID, status: TaskStatus) => boolean
  updateTaskPriority: (taskId: ID, priority: Priority) => boolean
  assignTask: (taskId: ID, assignee: User) => boolean
  unassignTask: (taskId: ID) => boolean
  
  // 批量操作
  bulkUpdateStatus: (taskIds: ID[], status: TaskStatus) => number
  bulkAssign: (taskIds: ID[], assignee: User) => number
  bulkDelete: (taskIds: ID[]) => number
  
  // 筛选和排序
  setFilter: (filters: Partial<Pick<TaskManagementState, 'filterStatus' | 'filterPriority' | 'filterAssignee'>>) => void
  setSearchQuery: (query: string) => void
  setSorting: (sortBy: keyof Task, sortOrder: 'asc' | 'desc') => void
  setViewMode: (mode: 'list' | 'kanban' | 'calendar') => void
  
  // 选择操作
  selectTask: (taskId: ID | null) => void
  toggleTaskSelection: (taskId: ID) => void
  selectAllTasks: () => void
  clearSelection: () => void
  
  // 获取操作
  getTask: (taskId: ID) => Task | null
  getTasksByStatus: (status: TaskStatus) => Task[]
  getTasksByAssignee: (assigneeId: ID) => Task[]
  getOverdueTasks: () => Task[]
  getUpcomingTasks: (days: number) => Task[]
}

export function useTaskManagement(initialTasks: Task[] = []) {
  // 初始状态
  const [state, setState] = useState<TaskManagementState>(() => {
    const tasksMap = initialTasks.reduce((acc, task) => {
      acc[task.id] = task
      return acc
    }, {} as Record<ID, Task>)

    return {
      tasks: tasksMap,
      selectedTaskId: null,
      filterStatus: null,
      filterPriority: null,
      filterAssignee: null,
      searchQuery: '',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      viewMode: 'list',
    }
  })

  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<ID>>(new Set())

  // ==================== 基本操作 ====================

  const createTask = useCallback((taskData: Partial<Task>): Task => {
    const now = new Date().toISOString()
    const task: Task = {
      id: stringUtils.generateId('task'),
      title: taskData.title || '',
      description: taskData.description || '',
      status: taskData.status || 'todo',
      priority: taskData.priority || 'medium',
      assignee: taskData.assignee,
      storyId: taskData.storyId,
      dueDate: taskData.dueDate,
      estimatedHours: taskData.estimatedHours,
      actualHours: taskData.actualHours || 0,
      tags: taskData.tags || [],
      createdAt: now,
      updatedAt: now,
      ...taskData,
    }

    setState(prev => ({
      ...prev,
      tasks: { ...prev.tasks, [task.id]: task }
    }))

    return task
  }, [])

  const updateTask = useCallback((taskId: ID, updates: Partial<Task>): Task | null => {
    const existingTask = state.tasks[taskId]
    if (!existingTask) return null

    const updatedTask: Task = {
      ...existingTask,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    setState(prev => ({
      ...prev,
      tasks: { ...prev.tasks, [taskId]: updatedTask }
    }))

    return updatedTask
  }, [state.tasks])

  const deleteTask = useCallback((taskId: ID): boolean => {
    if (!state.tasks[taskId]) return false

    setState(prev => {
      const newTasks = { ...prev.tasks }
      delete newTasks[taskId]
      return { ...prev, tasks: newTasks }
    })

    // 从选中列表中移除
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev)
      newSet.delete(taskId)
      return newSet
    })

    return true
  }, [state.tasks])

  const duplicateTask = useCallback((taskId: ID): Task | null => {
    const existingTask = state.tasks[taskId]
    if (!existingTask) return null

    const duplicatedTask = {
      ...existingTask,
      id: stringUtils.generateId('task'),
      title: `${existingTask.title} (副本)`,
      status: 'todo' as TaskStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    setState(prev => ({
      ...prev,
      tasks: { ...prev.tasks, [duplicatedTask.id]: duplicatedTask }
    }))

    return duplicatedTask
  }, [state.tasks])

  // ==================== 状态操作 ====================

  const updateTaskStatus = useCallback((taskId: ID, status: TaskStatus): boolean => {
    return updateTask(taskId, { status }) !== null
  }, [updateTask])

  const updateTaskPriority = useCallback((taskId: ID, priority: Priority): boolean => {
    return updateTask(taskId, { priority }) !== null
  }, [updateTask])

  const assignTask = useCallback((taskId: ID, assignee: User): boolean => {
    return updateTask(taskId, { assignee }) !== null
  }, [updateTask])

  const unassignTask = useCallback((taskId: ID): boolean => {
    return updateTask(taskId, { assignee: undefined }) !== null
  }, [updateTask])

  // ==================== 批量操作 ====================

  const bulkUpdateStatus = useCallback((taskIds: ID[], status: TaskStatus): number => {
    let updatedCount = 0
    
    setState(prev => {
      const newTasks = { ...prev.tasks }
      const now = new Date().toISOString()
      
      taskIds.forEach(taskId => {
        if (newTasks[taskId]) {
          newTasks[taskId] = { ...newTasks[taskId], status, updatedAt: now }
          updatedCount++
        }
      })
      
      return { ...prev, tasks: newTasks }
    })
    
    return updatedCount
  }, [])

  const bulkAssign = useCallback((taskIds: ID[], assignee: User): number => {
    let updatedCount = 0
    
    setState(prev => {
      const newTasks = { ...prev.tasks }
      const now = new Date().toISOString()
      
      taskIds.forEach(taskId => {
        if (newTasks[taskId]) {
          newTasks[taskId] = { ...newTasks[taskId], assignee, updatedAt: now }
          updatedCount++
        }
      })
      
      return { ...prev, tasks: newTasks }
    })
    
    return updatedCount
  }, [])

  const bulkDelete = useCallback((taskIds: ID[]): number => {
    let deletedCount = 0
    
    setState(prev => {
      const newTasks = { ...prev.tasks }
      taskIds.forEach(taskId => {
        if (newTasks[taskId]) {
          delete newTasks[taskId]
          deletedCount++
        }
      })
      return { ...prev, tasks: newTasks }
    })
    
    // 从选中列表中移除
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev)
      taskIds.forEach(id => newSet.delete(id))
      return newSet
    })
    
    return deletedCount
  }, [])

  // ==================== 筛选和排序 ====================

  const setFilter = useCallback((filters: Partial<Pick<TaskManagementState, 'filterStatus' | 'filterPriority' | 'filterAssignee'>>) => {
    setState(prev => ({ ...prev, ...filters }))
  }, [])

  const setSearchQuery = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }))
  }, [])

  const setSorting = useCallback((sortBy: keyof Task, sortOrder: 'asc' | 'desc') => {
    setState(prev => ({ ...prev, sortBy, sortOrder }))
  }, [])

  const setViewMode = useCallback((mode: 'list' | 'kanban' | 'calendar') => {
    setState(prev => ({ ...prev, viewMode: mode }))
  }, [])

  // ==================== 选择操作 ====================

  const selectTask = useCallback((taskId: ID | null) => {
    setState(prev => ({ ...prev, selectedTaskId: taskId }))
  }, [])

  const toggleTaskSelection = useCallback((taskId: ID) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(taskId)) {
        newSet.delete(taskId)
      } else {
        newSet.add(taskId)
      }
      return newSet
    })
  }, [])

  const selectAllTasks = useCallback(() => {
    const allTaskIds = Object.keys(state.tasks) as ID[]
    setSelectedTaskIds(new Set(allTaskIds))
  }, [state.tasks])

  const clearSelection = useCallback(() => {
    setSelectedTaskIds(new Set())
    setState(prev => ({ ...prev, selectedTaskId: null }))
  }, [])

  // ==================== 获取操作 ====================

  const getTask = useCallback((taskId: ID): Task | null => {
    return state.tasks[taskId] || null
  }, [state.tasks])

  const getTasksByStatus = useCallback((status: TaskStatus): Task[] => {
    return Object.values(state.tasks).filter(task => task.status === status)
  }, [state.tasks])

  const getTasksByAssignee = useCallback((assigneeId: ID): Task[] => {
    return Object.values(state.tasks).filter(task => task.assignee?.id === assigneeId)
  }, [state.tasks])

  const getOverdueTasks = useCallback((): Task[] => {
    const now = new Date()
    return Object.values(state.tasks).filter(task => {
      if (!task.dueDate) return false
      return new Date(task.dueDate) < now && task.status !== 'done'
    })
  }, [state.tasks])

  const getUpcomingTasks = useCallback((days: number = 7): Task[] => {
    const now = new Date()
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    
    return Object.values(state.tasks).filter(task => {
      if (!task.dueDate) return false
      const dueDate = new Date(task.dueDate)
      return dueDate >= now && dueDate <= futureDate && task.status !== 'done'
    })
  }, [state.tasks])

  // ==================== 计算属性 ====================

  const filteredTasks = useMemo(() => {
    let tasks = Object.values(state.tasks)

    // 应用筛选
    if (state.filterStatus) {
      tasks = tasks.filter(task => task.status === state.filterStatus)
    }
    if (state.filterPriority) {
      tasks = tasks.filter(task => task.priority === state.filterPriority)
    }
    if (state.filterAssignee) {
      tasks = tasks.filter(task => task.assignee?.id === state.filterAssignee)
    }

    // 应用搜索
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase()
      tasks = tasks.filter(task => 
        task.title.toLowerCase().includes(query) ||
        task.description.toLowerCase().includes(query) ||
        task.tags.some(tag => tag.toLowerCase().includes(query))
      )
    }

    // 应用排序
    tasks.sort((a, b) => {
      const aValue = a[state.sortBy]
      const bValue = b[state.sortBy]
      
      if (aValue < bValue) return state.sortOrder === 'asc' ? -1 : 1
      if (aValue > bValue) return state.sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return tasks
  }, [state])

  const tasksByStatus = useMemo(() => {
    const groups = {
      todo: [] as Task[],
      'in-progress': [] as Task[],
      review: [] as Task[],
      done: [] as Task[],
    }

    filteredTasks.forEach(task => {
      if (groups[task.status]) {
        groups[task.status].push(task)
      }
    })

    return groups
  }, [filteredTasks])

  const statistics = useMemo(() => {
    const total = Object.keys(state.tasks).length
    const completed = Object.values(state.tasks).filter(task => task.status === 'done').length
    const inProgress = Object.values(state.tasks).filter(task => task.status === 'in-progress').length
    const overdue = getOverdueTasks().length
    const upcoming = getUpcomingTasks().length

    return {
      total,
      completed,
      inProgress,
      overdue,
      upcoming,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    }
  }, [state.tasks, getOverdueTasks, getUpcomingTasks])

  // ==================== 返回接口 ====================

  const operations: TaskOperations = {
    // 基本操作
    createTask,
    updateTask,
    deleteTask,
    duplicateTask,
    
    // 状态操作
    updateTaskStatus,
    updateTaskPriority,
    assignTask,
    unassignTask,
    
    // 批量操作
    bulkUpdateStatus,
    bulkAssign,
    bulkDelete,
    
    // 筛选和排序
    setFilter,
    setSearchQuery,
    setSorting,
    setViewMode,
    
    // 选择操作
    selectTask,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
    
    // 获取操作
    getTask,
    getTasksByStatus,
    getTasksByAssignee,
    getOverdueTasks,
    getUpcomingTasks,
  }

  return {
    // 状态
    ...state,
    filteredTasks,
    tasksByStatus,
    statistics,
    selectedTaskIds: Array.from(selectedTaskIds),
    
    // 操作
    ...operations,
  }
}

export default useTaskManagement
