import type React from "react"
export interface KanbanItem {
  id: string
  title: string
  content?: string
  status: string
  priority?: "low" | "medium" | "high"
  type: "project" | "prd" | "epic" | "story" | "task"
  assignee?: string
  dueDate?: string
  createdAt: string
  updatedAt: string
}

export interface EnhancedKanbanItem extends KanbanItem {
  dependencies?: string[]
  blockedBy?: string[]
  aiSuggestions?: number
  lastAIReview?: string
}

export const statusColumns = {
  project: [
    { id: "planning", title: "规划中", color: "bg-blue-100" },
    { id: "active", title: "进行中", color: "bg-yellow-100" },
    { id: "review", title: "评审中", color: "bg-purple-100" },
    { id: "completed", title: "已完成", color: "bg-green-100" },
  ],
  prd: [
    { id: "draft", title: "草稿", color: "bg-gray-100" },
    { id: "review", title: "评审中", color: "bg-yellow-100" },
    { id: "approved", title: "已批准", color: "bg-green-100" },
  ],
  epic: [
    { id: "backlog", title: "待办", color: "bg-gray-100" },
    { id: "planning", title: "规划中", color: "bg-blue-100" },
    { id: "development", title: "开发中", color: "bg-yellow-100" },
    { id: "testing", title: "测试中", color: "bg-purple-100" },
    { id: "done", title: "完成", color: "bg-green-100" },
  ],
  story: [
    { id: "backlog", title: "待办", color: "bg-gray-100" },
    { id: "ready", title: "就绪", color: "bg-blue-100" },
    { id: "development", title: "开发中", color: "bg-yellow-100" },
    { id: "testing", title: "测试中", color: "bg-purple-100" },
    { id: "done", title: "完成", color: "bg-green-100" },
  ],
}

export const getProgressStats = (items: KanbanItem[]) => {
  const total = items.length
  const completed = items.filter(
    (item) => item.status === "completed" || item.status === "done" || item.status === "approved",
  ).length
  const inProgress = items.filter(
    (item) =>
      item.status === "active" ||
      item.status === "development" ||
      item.status === "testing" ||
      item.status === "review",
  ).length
  const todo = items.filter(
    (item) =>
      item.status === "planning" || item.status === "draft" || item.status === "backlog" || item.status === "ready",
  ).length
  const progress = total > 0 ? (completed / total) * 100 : 0

  return { total, completed, inProgress, todo, progress }
}

export const getItemsByStatus = (items: KanbanItem[], status: string) => {
  return items.filter((item) => item.status === status)
}

export const handleDragOver = (e: React.DragEvent, columnId: string, setDraggedOver: (id: string | null) => void) => {
  e.preventDefault()
  setDraggedOver(columnId)
}

export const handleDragLeave = () => {
  // Handle drag leave if needed
}

export const handleDrop = (
  e: React.DragEvent,
  columnId: string,
  setDraggedItem: (id: string | null) => void,
  setDraggedOver: (id: string | null) => void,
  onStatusChange: (itemId: string, newStatus: string) => void,
) => {
  e.preventDefault()
  const itemId = e.dataTransfer.getData("text/plain")
  if (itemId) {
    onStatusChange(itemId, columnId)
  }
  setDraggedItem(null)
  setDraggedOver(null)
}

export const handleDragStart = (e: React.DragEvent, itemId: string, setDraggedItem: (id: string | null) => void) => {
  e.dataTransfer.setData("text/plain", itemId)
  setDraggedItem(itemId)
}

export const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "high":
      return "bg-red-100 text-red-800"
    case "medium":
      return "bg-yellow-100 text-yellow-800"
    case "low":
      return "bg-green-100 text-green-800"
    default:
      return "bg-gray-100 text-gray-800"
  }
}

export const getPriorityLabel = (priority: string) => {
  switch (priority) {
    case "high":
      return "高"
    case "medium":
      return "中"
    case "low":
      return "低"
    default:
      return "无"
  }
}
