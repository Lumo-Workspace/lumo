"use client"

import { useState, useCallback } from "react"
import type { TaskWidget } from "./use-document-blocks"

export function useTaskManagement() {
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskWidget | null>(null)
  const [modalMode, setModalMode] = useState<"create" | "edit">("create")

  const openCreateTaskModal = useCallback(() => {
    setModalMode("create")
    setEditingTask(null)
    setIsTaskModalOpen(true)
  }, [])

  const openEditTaskModal = useCallback((task: TaskWidget) => {
    setEditingTask(task)
    setModalMode("edit")
    setIsTaskModalOpen(true)
  }, [])

  const closeTaskModal = useCallback(() => {
    setIsTaskModalOpen(false)
    setEditingTask(null)
  }, [])

  const handleTaskStatusChange = useCallback((taskId: string, newStatus: TaskWidget["status"]) => {
    // This will be handled by the parent component
    return { taskId, newStatus }
  }, [])

  return {
    isTaskModalOpen,
    editingTask,
    modalMode,
    openCreateTaskModal,
    openEditTaskModal,
    closeTaskModal,
    handleTaskStatusChange,
  }
}
