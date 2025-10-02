"use client"

import { useState } from "react"

export function useUIState() {
  const [currentView, setCurrentView] = useState<"editor" | "inbox" | "shared" | "teams">("editor")
  const [showAIChat, setShowAIChat] = useState(false)
  const [aiChatFullscreen, setAiChatFullscreen] = useState(false)
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true)
  const [teamsExpanded, setTeamsExpanded] = useState(true)
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  const [teamViewMode, setTeamViewMode] = useState<"document" | "kanban">("document")

  const [contextMenu, setContextMenu] = useState<{
    show: boolean
    x: number
    y: number
    pageId: string
  }>({
    show: false,
    x: 0,
    y: 0,
    pageId: "",
  })

  const [deleteDialog, setDeleteDialog] = useState<{
    show: boolean
    pageId: string
    pageTitle: string
  }>({
    show: false,
    pageId: "",
    pageTitle: "",
  })

  const closeContextMenu = () => {
    setContextMenu({ show: false, x: 0, y: 0, pageId: "" })
  }

  const showDeleteDialog = (pageId: string, pageTitle: string) => {
    setDeleteDialog({ show: true, pageId, pageTitle })
  }

  const hideDeleteDialog = () => {
    setDeleteDialog({ show: false, pageId: "", pageTitle: "" })
  }

  return {
    currentView,
    setCurrentView,
    showAIChat,
    setShowAIChat,
    aiChatFullscreen,
    setAiChatFullscreen,
    workspaceExpanded,
    setWorkspaceExpanded,
    teamsExpanded,
    setTeamsExpanded,
    editingPageId,
    setEditingPageId,
    editingTitle,
    setEditingTitle,
    teamViewMode,
    setTeamViewMode,
    contextMenu,
    setContextMenu,
    deleteDialog,
    closeContextMenu,
    showDeleteDialog,
    hideDeleteDialog,
  }
}
