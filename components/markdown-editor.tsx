"use client"

import { useState } from "react"

// 组件导入
import SlashMenu from "./slash-menu"
import ContextMenu from "./context-menu"
import DeleteDialog from "./delete-dialog"
import Sidebar from "./sidebar"
import InboxView from "./inbox-view"
import EditorView from "./editor-view"
import SharedView from "./shared-view"
import TeamView from "./team-view"
import AIChat from "./ai-chat"

// Hooks导入
import { usePages } from "../hooks/use-pages"
import { useBlocks } from "../hooks/use-blocks"
import { useNotifications } from "../hooks/use-notifications"
import { useUIState } from "../hooks/use-ui-state"
import { useTeams } from "../hooks/use-teams"

export default function MarkdownEditor() {
  // 页面管理
  const {
    pages,
    currentPageId,
    setCurrentPageId,
    getCurrentPage,
    getCurrentBlocks,
    togglePageExpansion,
    expandPathToPage,
    createNewPage,
    updatePageTitle,
    deletePage,
    setPages,
  } = usePages()

  // 块管理
  const {
    showSlashMenu,
    setShowSlashMenu,
    slashMenuPosition,
    slashMenuSearch,
    setSlashMenuSearch,
    activeBlockId,
    focusedBlockId,
    addNewBlock,
    updateBlock,
    changeBlockType,
    toggleTodo,
    handleKeyDown,
    handleFocus,
    handleBlur,
  } = useBlocks({ pages, setPages, currentPageId })

  const { notifications, selectedNotification, setSelectedNotification, markNotificationAsRead } = useNotifications()

  const {
    teams,
    currentTeamId,
    currentProjectId,
    currentPRDId,
    currentEpicId,
    currentStoryId,
    currentTaskId,
    setCurrentTeamId,
    setCurrentProjectId,
    setCurrentPRDId,
    setCurrentEpicId,
    setCurrentStoryId,
    setCurrentTaskId,
    toggleTeamExpansion,
    toggleProjectExpansion,
    togglePRDExpansion,
    toggleEpicExpansion,
    toggleStoryExpansion,
    updateItemStatus,
  } = useTeams()

  const {
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
  } = useUIState()

  const handleContextMenu = (e: React.MouseEvent, pageId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ show: true, x: e.clientX, y: e.clientY, pageId })
  }

  const handleRename = (pageId: string) => {
    const page = pages[pageId]
    if (page) {
      setEditingPageId(pageId)
      setEditingTitle(page.title)
    }
    closeContextMenu()
  }

  const handleDelete = (pageId: string) => {
    const page = pages[pageId]
    if (page) {
      showDeleteDialog(pageId, page.title)
    }
    closeContextMenu()
  }

  const confirmDelete = () => {
    deletePage(deleteDialog.pageId)
    hideDeleteDialog()
  }

  const handleTitleSubmit = (pageId: string) => {
    if (editingTitle.trim()) {
      updatePageTitle(pageId, editingTitle)
    }
    setEditingPageId(null)
    setEditingTitle("")
  }

  const switchToDocument = (documentId: string) => {
    if (pages[documentId]) {
      expandPathToPage(documentId)
      setCurrentPageId(documentId)
      setCurrentView("editor")
      setSelectedNotification(null)
      setWorkspaceExpanded(true) // Ensure workspace is expanded
    }
  }

  const handlePageClick = (pageId: string) => {
    setCurrentPageId(pageId)
    setCurrentView("editor")
    setSelectedNotification(null)
  }

  const handleTeamClick = (teamId: string) => {
    setCurrentTeamId(teamId)
    setCurrentProjectId("")
    setCurrentPRDId("")
    setCurrentEpicId("")
    setCurrentStoryId("")
    setCurrentTaskId("")
    setCurrentView("teams")
  }

  const handleProjectClick = (teamId: string, projectId: string) => {
    setCurrentTeamId(teamId)
    setCurrentProjectId(projectId)
    setCurrentPRDId("")
    setCurrentEpicId("")
    setCurrentStoryId("")
    setCurrentTaskId("")
    setCurrentView("teams")
  }

  const handlePRDClick = (teamId: string, projectId: string, prdId: string) => {
    setCurrentTeamId(teamId)
    setCurrentProjectId(projectId)
    setCurrentPRDId(prdId)
    setCurrentEpicId("")
    setCurrentStoryId("")
    setCurrentTaskId("")
    setCurrentView("teams")
  }

  const handleEpicClick = (teamId: string, projectId: string, prdId: string, epicId: string) => {
    setCurrentTeamId(teamId)
    setCurrentProjectId(projectId)
    setCurrentPRDId(prdId)
    setCurrentEpicId(epicId)
    setCurrentStoryId("")
    setCurrentTaskId("")
    setCurrentView("teams")
  }

  const handleStoryClick = (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => {
    setCurrentTeamId(teamId)
    setCurrentProjectId(projectId)
    setCurrentPRDId(prdId)
    setCurrentEpicId(epicId)
    setCurrentStoryId(storyId)
    setCurrentTaskId("")
    setCurrentView("teams")
  }

  const handleTaskClick = (
    teamId: string,
    projectId: string,
    prdId: string,
    epicId: string,
    storyId: string,
    taskId: string,
  ) => {
    setCurrentTeamId(teamId)
    setCurrentProjectId(projectId)
    setCurrentPRDId(prdId)
    setCurrentEpicId(epicId)
    setCurrentStoryId(storyId)
    setCurrentTaskId(taskId)
    setCurrentView("teams")
  }

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800" onClick={(e) => {
      closeContextMenu()
      // Close slash menu if clicking outside of it
      if (showSlashMenu && !(e.target as Element).closest('.slash-menu')) {
        setShowSlashMenu(false)
      }
    }}>
      {showAIChat && aiChatFullscreen ? (
        // Fullscreen AI Chat
        <div className="fixed inset-0 z-50 bg-white">
          <AIChat
            onClose={() => setShowAIChat(false)}
            isFullscreen={true}
            onToggleFullscreen={() => setAiChatFullscreen(false)}
          />
        </div>
      ) : (
        <>
          {showAIChat ? (
            <div className="w-64">
              <AIChat
                onClose={() => setShowAIChat(false)}
                isFullscreen={false}
                onToggleFullscreen={() => setAiChatFullscreen(true)}
              />
            </div>
          ) : (
            <Sidebar
              pages={pages}
              currentPageId={currentPageId}
              currentView={currentView}
              notifications={notifications}
              workspaceExpanded={workspaceExpanded}
              teamsExpanded={teamsExpanded}
              teams={teams}
              currentTeamId={currentTeamId}
              currentProjectId={currentProjectId}
              currentPRDId={currentPRDId}
              currentEpicId={currentEpicId}
              currentStoryId={currentStoryId}
              currentTaskId={currentTaskId}
              editingPageId={editingPageId}
              editingTitle={editingTitle}
              onViewChange={setCurrentView}
              onWorkspaceToggle={() => setWorkspaceExpanded(!workspaceExpanded)}
              onTeamsToggle={() => setTeamsExpanded(!teamsExpanded)}
              onTeamClick={handleTeamClick}
              onProjectClick={handleProjectClick}
              onPRDClick={handlePRDClick}
              onEpicClick={handleEpicClick}
              onStoryClick={handleStoryClick}
              onTaskClick={handleTaskClick}
              onToggleTeamExpansion={toggleTeamExpansion}
              onToggleProjectExpansion={toggleProjectExpansion}
              onTogglePRDExpansion={togglePRDExpansion}
              onToggleEpicExpansion={toggleEpicExpansion}
              onToggleStoryExpansion={toggleStoryExpansion}
              onPageClick={handlePageClick}
              onToggleExpansion={togglePageExpansion}
              onCreateNewPage={createNewPage}
              onContextMenu={handleContextMenu}
              onTitleChange={setEditingTitle}
              onTitleSubmit={handleTitleSubmit}
              onTitleCancel={() => {
                setEditingPageId(null)
                setEditingTitle("")
              }}
              onAIToggle={() => setShowAIChat(true)}
            />
          )}

          {currentView === "inbox" ? (
            <InboxView
              notifications={notifications}
              selectedNotification={selectedNotification}
              onNotificationSelect={setSelectedNotification}
              onMarkAsRead={markNotificationAsRead}
              onSwitchToDocument={switchToDocument}
              pages={pages}
            />
          ) : currentView === "shared" ? (
            <SharedView onSwitchToDocument={switchToDocument} />
          ) : currentView === "teams" ? (
            <TeamView
              teams={teams}
              currentTeamId={currentTeamId}
              currentProjectId={currentProjectId}
              currentPRDId={currentPRDId}
              currentEpicId={currentEpicId}
              currentStoryId={currentStoryId}
              currentTaskId={currentTaskId}
              viewMode={teamViewMode}
              onViewModeChange={setTeamViewMode}
              onStatusChange={updateItemStatus}
            />
          ) : (
            <EditorView
              pages={pages}
              currentPageId={currentPageId}
              blocks={getCurrentBlocks()}
              focusedBlockId={focusedBlockId}
              onPageClick={setCurrentPageId}
              onUpdateBlock={updateBlock}
              onKeyDown={handleKeyDown}
              onToggleTodo={toggleTodo}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onAddBlock={addNewBlock}
              onChangeBlockType={changeBlockType}
            />
          )}
        </>
      )}

      {!(showAIChat && aiChatFullscreen) && (
        <>
          <SlashMenu
            show={showSlashMenu}
            position={slashMenuPosition}
            searchQuery={slashMenuSearch}
            onSearchChange={setSlashMenuSearch}
            onBlockTypeSelect={(blockType) => {
              console.log("[v0] Block type selected:", blockType, "Active block:", activeBlockId)
              if (activeBlockId) {
                changeBlockType(activeBlockId, blockType)
                setSlashMenuSearch("") // Clear search when block type is selected
              }
            }}
            onClose={() => {
              console.log("[v0] Slash menu closed")
              setShowSlashMenu(false)
            }}
          />

          <ContextMenu
            show={contextMenu.show}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onRename={() => handleRename(contextMenu.pageId)}
            onDelete={() => handleDelete(contextMenu.pageId)}
            onClose={closeContextMenu}
          />

          <DeleteDialog
            show={deleteDialog.show}
            pageTitle={deleteDialog.pageTitle}
            onConfirm={confirmDelete}
            onCancel={hideDeleteDialog}
          />
        </>
      )}
    </div>
  )
}
