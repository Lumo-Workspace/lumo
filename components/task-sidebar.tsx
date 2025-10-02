"use client"

import type React from "react"
import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, Filter, Calendar } from "lucide-react"
import TaskWidgetComponent from "@/components/task-widget"

interface TaskWidget {
  id: string
  title: string
  status: "draft" | "active" | "in-review" | "blocked" | "completed"
  assignee?: string
  dueDate?: Date
  priority: "low" | "medium" | "high"
}

interface TaskSidebarProps {
  tasks: TaskWidget[]
  onTaskStatusChange: (taskId: string, newStatus: TaskWidget["status"]) => void
  onTaskEdit: (taskId: string) => void
  onTaskDelete: (taskId: string) => void
  className?: string
}

const TaskSidebar: React.FC<TaskSidebarProps> = ({
  tasks,
  onTaskStatusChange,
  onTaskEdit,
  onTaskDelete,
  className,
}) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all")
  const [priorityFilter, setPriorityFilter] = useState<string>("all")

  // Get unique assignees for filter
  const uniqueAssignees = useMemo(() => {
    const assignees = tasks.map((task) => task.assignee).filter((assignee): assignee is string => Boolean(assignee))
    return Array.from(new Set(assignees))
  }, [tasks])

  // Filter tasks based on current filters
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Search filter
      if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }

      // Status filter
      if (statusFilter !== "all" && task.status !== statusFilter) {
        return false
      }

      // Assignee filter
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned" && task.assignee) {
          return false
        }
        if (assigneeFilter !== "unassigned" && task.assignee !== assigneeFilter) {
          return false
        }
      }

      // Priority filter
      if (priorityFilter !== "all" && task.priority !== priorityFilter) {
        return false
      }

      return true
    })
  }, [tasks, searchQuery, statusFilter, assigneeFilter, priorityFilter])

  // Task statistics
  const taskStats = useMemo(() => {
    const stats = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      active: tasks.filter((t) => t.status === "active").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      overdue: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date()).length,
    }
    return stats
  }, [tasks])

  const clearFilters = () => {
    setSearchQuery("")
    setStatusFilter("all")
    setAssigneeFilter("all")
    setPriorityFilter("all")
  }

  const hasActiveFilters = searchQuery || statusFilter !== "all" || assigneeFilter !== "all" || priorityFilter !== "all"

  return (
    <div className={cn("w-80 bg-white border-l border-gray-200 flex flex-col", className)}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
          <Badge variant="secondary" className="text-xs">
            {filteredTasks.length} of {tasks.length}
          </Badge>
        </div>

        {/* Task Statistics */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-gray-50 rounded-lg p-2 text-center">
            <div className="text-lg font-semibold text-gray-900">{taskStats.completed}</div>
            <div className="text-xs text-gray-500">Completed</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-2 text-center">
            <div className="text-lg font-semibold text-blue-600">{taskStats.active}</div>
            <div className="text-xs text-gray-500">Active</div>
          </div>
          <div className="bg-red-50 rounded-lg p-2 text-center">
            <div className="text-lg font-semibold text-red-600">{taskStats.blocked}</div>
            <div className="text-xs text-gray-500">Blocked</div>
          </div>
          <div className="bg-amber-50 rounded-lg p-2 text-center">
            <div className="text-lg font-semibold text-amber-600">{taskStats.overdue}</div>
            <div className="text-xs text-gray-500">Overdue</div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="in-review">In Review</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Filter by assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {uniqueAssignees.map((assignee) => (
                <SelectItem key={assignee} value={assignee}>
                  {assignee}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Filter by priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="high">High Priority</SelectItem>
              <SelectItem value="medium">Medium Priority</SelectItem>
              <SelectItem value="low">Low Priority</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="w-full mt-2 text-xs">
            Clear Filters
          </Button>
        )}
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-gray-400 mb-2">
              {tasks.length === 0 ? (
                <Calendar className="h-12 w-12 mx-auto mb-2" />
              ) : (
                <Filter className="h-12 w-12 mx-auto mb-2" />
              )}
            </div>
            <p className="text-sm text-gray-500">
              {tasks.length === 0 ? "No tasks in document" : "No tasks match your filters"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTasks.map((task) => (
              <TaskWidgetComponent
                key={task.id}
                task={task}
                context={{
                  isEmbedded: false,
                  canEdit: true,
                  showFullDetails: false,
                }}
                onStatusChange={onTaskStatusChange}
                onEdit={onTaskEdit}
                onDelete={onTaskDelete}
                className="text-sm"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default TaskSidebar
