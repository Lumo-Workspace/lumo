"use client"

import { useState, useCallback, useMemo } from "react"
import type { ViewType, ViewMode, ContextMenuState, DeleteDialogState } from "@/types"
import { STORAGE_KEYS } from "@/constants"
import { storage as storageUtils } from "@/utils"

// ==================== UI状态接口 ====================

interface UIState {
  currentView: ViewType
  showAIChat: boolean
  aiChatFullscreen: boolean
  workspaceExpanded: boolean
  teamsExpanded: boolean
  editingPageId: string | null
  editingTitle: string
  teamViewMode: ViewMode
  contextMenu: ContextMenuState
  deleteDialog: DeleteDialogState
}

// ==================== 默认状态 ====================

const DEFAULT_STATE: UIState = {
  currentView: "document",
  showAIChat: false,
  aiChatFullscreen: false,
  workspaceExpanded: true,
  teamsExpanded: true,
  editingPageId: null,
  editingTitle: "",
  teamViewMode: "list",
  contextMenu: {
    show: false,
    position: { x: 0, y: 0 },
    onRename: () => {},
    onDelete: () => {},
  },
  deleteDialog: {
    show: false,
    itemType: "",
    itemName: "",
    onConfirm: () => {},
    onCancel: () => {},
  },
}

export function useUIState() {
  // 从本地存储恢复状态
  const [state, setState] = useState<UIState>(() => {
    const savedState = storageUtils.get<Partial<UIState>>(STORAGE_KEYS.userPreferences, {})
    return { ...DEFAULT_STATE, ...savedState }
  })

  // 保存状态到本地存储
  const saveState = useCallback((newState: Partial<UIState>) => {
    setState(prev => {
      const updatedState = { ...prev, ...newState }
      storageUtils.set(STORAGE_KEYS.userPreferences, updatedState)
      return updatedState
    })
  }, [])

  // 重置状态
  const resetState = useCallback(() => {
    setState(DEFAULT_STATE)
    storageUtils.remove(STORAGE_KEYS.userPreferences)
  }, [])

  // 上下文菜单操作
  const closeContextMenu = useCallback(() => {
    setState(prev => ({
      ...prev,
      contextMenu: { show: false, x: 0, y: 0, pageId: "" }
    }))
  }, [])

  const showContextMenu = useCallback((x: number, y: number, pageId: string) => {
    setState(prev => ({
      ...prev,
      contextMenu: { show: true, x, y, pageId }
    }))
  }, [])

  // 删除对话框操作
  const showDeleteDialog = useCallback((pageId: string, pageTitle: string) => {
    setState(prev => ({
      ...prev,
      deleteDialog: { show: true, pageId, pageTitle }
    }))
  }, [])

  const hideDeleteDialog = useCallback(() => {
    setState(prev => ({
      ...prev,
      deleteDialog: { show: false, pageId: "", pageTitle: "" }
    }))
  }, [])

  // AI聊天操作
  const toggleAIChat = useCallback(() => {
    setState(prev => ({ ...prev, showAIChat: !prev.showAIChat }))
  }, [])

  const toggleAIChatFullscreen = useCallback(() => {
    setState(prev => ({ ...prev, aiChatFullscreen: !prev.aiChatFullscreen }))
  }, [])

  // 侧边栏操作
  const toggleWorkspace = useCallback(() => {
    setState(prev => ({ ...prev, workspaceExpanded: !prev.workspaceExpanded }))
  }, [])

  const toggleTeams = useCallback(() => {
    setState(prev => ({ ...prev, teamsExpanded: !prev.teamsExpanded }))
  }, [])

  // 编辑操作
  const startEditing = useCallback((pageId: string, title: string) => {
    setState(prev => ({
      ...prev,
      editingPageId: pageId,
      editingTitle: title
    }))
  }, [])

  const stopEditing = useCallback(() => {
    setState(prev => ({
      ...prev,
      editingPageId: null,
      editingTitle: ""
    }))
  }, [])

  // 计算属性
  const isEditing = useMemo(() => state.editingPageId !== null, [state.editingPageId])
  const hasContextMenu = useMemo(() => state.contextMenu.show, [state.contextMenu.show])
  const hasDeleteDialog = useMemo(() => state.deleteDialog.show, [state.deleteDialog.show])

  return {
    // 状态
    ...state,
    
    // 计算属性
    isEditing,
    hasContextMenu,
    hasDeleteDialog,
    
    // 操作方法
    saveState,
    resetState,
    
    // 上下文菜单
    closeContextMenu,
    showContextMenu,
    
    // 删除对话框
    showDeleteDialog,
    hideDeleteDialog,
    
    // AI聊天
    toggleAIChat,
    toggleAIChatFullscreen,
    
    // 侧边栏
    toggleWorkspace,
    toggleTeams,
    
    // 编辑
    startEditing,
    stopEditing,
    
    // 设置器（保持向后兼容）
    setCurrentView: (view: ViewType) => saveState({ currentView: view }),
    setShowAIChat: (show: boolean) => saveState({ showAIChat: show }),
    setAiChatFullscreen: (fullscreen: boolean) => saveState({ aiChatFullscreen: fullscreen }),
    setWorkspaceExpanded: (expanded: boolean) => saveState({ workspaceExpanded: expanded }),
    setTeamsExpanded: (expanded: boolean) => saveState({ teamsExpanded: expanded }),
    setEditingPageId: (id: string | null) => saveState({ editingPageId: id }),
    setEditingTitle: (title: string) => saveState({ editingTitle: title }),
    setTeamViewMode: (mode: ViewMode) => saveState({ teamViewMode: mode }),
    setContextMenu: (menu: ContextMenuState) => saveState({ contextMenu: menu }),
    setDeleteDialog: (dialog: DeleteDialogState) => saveState({ deleteDialog: dialog }),
  }
}
