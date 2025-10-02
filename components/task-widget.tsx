"use client"

import type React from "react"
import { useState } from "react"
import { cn } from "@/lib/utils"

// TypeScript interfaces as specified
interface TaskWidget {
  id: string
  title: string
  status: "draft" | "active" | "in-review" | "blocked" | "completed"
  assignee?: string
  dueDate?: Date
  priority: "low" | "medium" | "high"
}

interface DocumentContext {
  isEmbedded: boolean
  canEdit: boolean
  showFullDetails: boolean
}

interface TaskWidgetProps {
  task: TaskWidget
  context: DocumentContext
  onStatusChange?: (taskId: string, newStatus: TaskWidget["status"]) => void
  onEdit?: (taskId: string) => void
  onDelete?: (taskId: string) => void
  className?: string
}

const TaskWidgetComponent: React.FC<TaskWidgetProps> = ({
  task,
  context,
  onStatusChange,
  onEdit,
  onDelete,
  className,
}) => {
  const [isLoading, setIsLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  // Status color mapping
  const getStatusColor = (status: TaskWidget["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-200"
      case "active":
        return "bg-blue-100 text-blue-800 border-blue-200"
      case "in-review":
        return "bg-amber-100 text-amber-800 border-amber-200"
      case "blocked":
        return "bg-red-100 text-red-800 border-red-200"
      case "draft":
        return "bg-gray-100 text-gray-800 border-gray-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  // Priority color mapping
  const getPriorityColor = (priority: TaskWidget["priority"]) => {
    switch (priority) {
      case "high":
        return "bg-red-500"
      case "medium":
        return "bg-amber-500"
      case "low":
        return "bg-green-500"
      default:
        return "bg-gray-500"
    }
  }

  // Handle status change with loading state
  const handleStatusChange = async (newStatus: TaskWidget["status"]) => {
    if (!context.canEdit || !onStatusChange) return

    setIsLoading(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 300)) // Simulate API call
      onStatusChange(task.id, newStatus)
    } finally {
      setIsLoading(false)
    }
  }

  // Format due date
  const formatDueDate = (date: Date) => {
    const now = new Date()
    const diffTime = date.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 0) return "Overdue"
    if (diffDays === 0) return "Due today"
    if (diffDays === 1) return "Due tomorrow"
    return `Due in ${diffDays} days`
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setIsExpanded(!isExpanded)
    }
    if (e.key === "Escape") {
      setIsExpanded(false)
    }
  }

  return (
    <div
      className={cn(
        "relative group transition-all duration-300 ease-out",
        "border border-gray-200 rounded-lg bg-white shadow-sm",
        "hover:shadow-md hover:border-gray-300",
        context.isEmbedded ? "inline-block max-w-sm" : "w-full",
        isHovered && "scale-[1.02]",
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Task: ${task.title}`}
      aria-expanded={isExpanded}
    >
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 rounded-lg flex items-center justify-center z-10">
          <div className="animate-pulse flex space-x-1">
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
            <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
          </div>
        </div>
      )}

      {/* Priority indicator */}
      <div className={cn("absolute top-0 left-0 w-1 h-full rounded-l-lg", getPriorityColor(task.priority))} />

      {/* Main content */}
      <div className="p-4 pl-6">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3
            className={cn(
              "font-medium text-gray-900 leading-tight",
              context.isEmbedded ? "text-sm" : "text-base",
              "text-balance",
            )}
          >
            {task.title}
          </h3>

          {/* Status badge */}
          <span
            className={cn(
              "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border",
              "transition-colors duration-200",
              getStatusColor(task.status),
            )}
          >
            {task.status.replace("-", " ")}
          </span>
        </div>

        {/* Compact info row - always visible */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          {task.assignee && (
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 bg-gray-300 rounded-full flex items-center justify-center text-xs font-medium">
                {task.assignee.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline">{task.assignee}</span>
            </div>
          )}

          {task.dueDate && (
            <div
              className={cn(
                "text-xs",
                new Date(task.dueDate) < new Date() ? "text-red-600 font-medium" : "text-gray-500",
              )}
            >
              {formatDueDate(task.dueDate)}
            </div>
          )}
        </div>

        {/* Expanded details - shown when showFullDetails is true or expanded */}
        {(context.showFullDetails || isExpanded) && (
          <div className="mt-4 pt-3 border-t border-gray-100 space-y-3">
            {/* Priority indicator */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Priority:</span>
              <div className="flex items-center gap-1">
                <div className={cn("w-2 h-2 rounded-full", getPriorityColor(task.priority))} />
                <span className="text-xs font-medium capitalize">{task.priority}</span>
              </div>
            </div>

            {/* Action buttons - only show if can edit */}
            {context.canEdit && (
              <div className="flex flex-wrap gap-2">
                {/* Status change buttons */}
                <div className="flex gap-1">
                  {(["draft", "active", "in-review", "blocked", "completed"] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => handleStatusChange(status)}
                      disabled={task.status === status || isLoading}
                      className={cn(
                        "px-2 py-1 text-xs rounded border transition-all duration-200",
                        "hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        "min-h-[44px] sm:min-h-0", // Touch-friendly on mobile
                        task.status === status
                          ? "bg-blue-100 border-blue-300 text-blue-800"
                          : "bg-white border-gray-300 text-gray-700",
                      )}
                      aria-label={`Change status to ${status}`}
                    >
                      {status.replace("-", " ")}
                    </button>
                  ))}
                </div>

                {/* Edit and delete buttons */}
                <div className="flex gap-1 ml-auto">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(task.id)}
                      className={cn(
                        "px-3 py-1 text-xs bg-blue-600 text-white rounded",
                        "hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
                        "transition-colors duration-200",
                        "min-h-[44px] sm:min-h-0", // Touch-friendly on mobile
                      )}
                      aria-label="Edit task"
                    >
                      Edit
                    </button>
                  )}

                  {onDelete && (
                    <button
                      onClick={() => onDelete(task.id)}
                      className={cn(
                        "px-3 py-1 text-xs bg-red-600 text-white rounded",
                        "hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1",
                        "transition-colors duration-200",
                        "min-h-[44px] sm:min-h-0", // Touch-friendly on mobile
                      )}
                      aria-label="Delete task"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expand/collapse button for embedded context */}
        {context.isEmbedded && !context.showFullDetails && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "mt-2 text-xs text-blue-600 hover:text-blue-800",
              "focus:outline-none focus:underline",
              "transition-colors duration-200",
            )}
            aria-label={isExpanded ? "Show less" : "Show more"}
          >
            {isExpanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  )
}

export default TaskWidgetComponent
