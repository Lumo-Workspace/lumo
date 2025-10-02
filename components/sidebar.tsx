"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import PageTree from "./page-tree"
import TeamTree from "./team-tree"
import CreateDialog from "./create-dialog"
import { useState } from "react"
import type { Team } from "../hooks/use-teams"

interface Page {
  id: string
  title: string
  parentId?: string
  children: string[]
  blocks: any[]
  isExpanded?: boolean
}

interface Notification {
  id: number
  title: string
  content: string
  time: string
  unread: boolean
  sender: string
  fullContent: string
  type: "comment" | "task" | "update" | "mention"
}

interface SidebarProps {
  pages: Record<string, Page>
  currentPageId: string
  currentView: "editor" | "inbox" | "shared" | "teams"
  notifications: Notification[]
  workspaceExpanded: boolean
  teamsExpanded: boolean
  teams: Record<string, Team>
  currentTeamId: string
  currentProjectId: string
  currentPRDId: string
  currentEpicId: string
  currentStoryId: string
  currentTaskId: string
  editingPageId: string | null
  editingTitle: string
  onViewChange: (view: "editor" | "inbox" | "shared" | "teams") => void
  onWorkspaceToggle: () => void
  onTeamsToggle: () => void
  onTeamClick: (teamId: string) => void
  onProjectClick: (teamId: string, projectId: string) => void
  onPRDClick: (teamId: string, projectId: string, prdId: string) => void
  onEpicClick: (teamId: string, projectId: string, prdId: string, epicId: string) => void
  onStoryClick: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => void
  onTaskClick: (
    teamId: string,
    projectId: string,
    prdId: string,
    epicId: string,
    storyId: string,
    taskId: string,
  ) => void
  onToggleTeamExpansion: (teamId: string) => void
  onToggleProjectExpansion: (teamId: string, projectId: string) => void
  onTogglePRDExpansion: (teamId: string, projectId: string, prdId: string) => void
  onToggleEpicExpansion: (teamId: string, projectId: string, prdId: string, epicId: string) => void
  onToggleStoryExpansion: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => void
  onPageClick: (pageId: string) => void
  onToggleExpansion: (pageId: string) => void
  onCreateNewPage: (parentId?: string, type?: string, title?: string) => void
  onContextMenu: (e: React.MouseEvent, pageId: string) => void
  onTitleChange: (title: string) => void
  onTitleSubmit: (pageId: string) => void
  onTitleCancel: () => void
  onAIToggle: () => void
}

export default function Sidebar({
  pages,
  currentPageId,
  currentView,
  notifications,
  workspaceExpanded,
  teamsExpanded,
  teams,
  currentTeamId,
  currentProjectId,
  currentPRDId,
  currentEpicId,
  currentStoryId,
  currentTaskId,
  editingPageId,
  editingTitle,
  onViewChange,
  onWorkspaceToggle,
  onTeamsToggle,
  onTeamClick,
  onProjectClick,
  onPRDClick,
  onEpicClick,
  onStoryClick,
  onTaskClick,
  onToggleTeamExpansion,
  onToggleProjectExpansion,
  onTogglePRDExpansion,
  onToggleEpicExpansion,
  onToggleStoryExpansion,
  onPageClick,
  onToggleExpansion,
  onCreateNewPage,
  onContextMenu,
  onTitleChange,
  onTitleSubmit,
  onTitleCancel,
  onAIToggle,
}: SidebarProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const handleCreatePage = (type: string, title?: string) => {
    onCreateNewPage(undefined, type, title)
  }

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-blue-600 to-purple-600 rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">I</span>
            </div>
            <span className="font-semibold text-gray-900">Lumo AI</span>
            <span className="text-gray-500">▼</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="w-8 h-8 p-0 hover:bg-gray-100">
              <span className="text-gray-600">🔍</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-8 h-8 p-0 hover:bg-gray-100"
              onClick={() => setShowCreateDialog(true)}
            >
              <span className="text-gray-600">✏️</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-auto">
        <div className="space-y-1">
          <div
            onClick={() => onViewChange("inbox")}
            className={`flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer -mx-2 ${
              currentView === "inbox" ? "bg-blue-100" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-gray-700">📥</span>
              <span className="text-sm text-gray-900">Inbox</span>
            </div>
            {notifications.filter((n) => n.unread).length > 0 && (
              <Badge variant="destructive" className="h-5 px-1.5 text-xs">
                {notifications.filter((n) => n.unread).length}
              </Badge>
            )}
          </div>

          <div
            onClick={() => onViewChange("shared")}
            className={`flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer -mx-2 ${
              currentView === "shared" ? "bg-blue-100" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-gray-700">👥</span>
              <span className="text-sm text-gray-900">Shared with me</span>
            </div>
          </div>

          <div
            onClick={onWorkspaceToggle}
            className="flex items-center px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer mt-4 -mx-2"
          >
            <span className="text-sm text-gray-900 font-medium">My Workspace</span>
            <div className="p-0.5 hover:bg-gray-200 rounded ml-1">
              <span className="text-gray-700">{workspaceExpanded ? "▼" : "▶"}</span>
            </div>
          </div>

          {workspaceExpanded && (
            <PageTree
              pages={pages}
              currentPageId={currentPageId}
              currentView={currentView}
              editingPageId={editingPageId}
              editingTitle={editingTitle}
              onPageClick={onPageClick}
              onToggleExpansion={onToggleExpansion}
              onCreateNewPage={onCreateNewPage}
              onContextMenu={onContextMenu}
              onTitleChange={onTitleChange}
              onTitleSubmit={onTitleSubmit}
              onTitleCancel={onTitleCancel}
            />
          )}

          <div
            onClick={onTeamsToggle}
            className="flex items-center px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer mt-4 -mx-2"
          >
            <span className="text-sm text-gray-900 font-medium">My Teams</span>
            <div className="p-0.5 hover:bg-gray-200 rounded ml-1">
              <span className="text-gray-700">{teamsExpanded ? "▼" : "▶"}</span>
            </div>
          </div>

          {teamsExpanded && (
            <TeamTree
              teams={teams}
              currentTeamId={currentTeamId}
              currentProjectId={currentProjectId}
              currentPRDId={currentPRDId}
              currentEpicId={currentEpicId}
              currentStoryId={currentStoryId}
              currentTaskId={currentTaskId}
              onTeamClick={onTeamClick}
              onProjectClick={onProjectClick}
              onPRDClick={onPRDClick}
              onEpicClick={onEpicClick}
              onStoryClick={onStoryClick}
              onTaskClick={onTaskClick}
              onToggleTeamExpansion={onToggleTeamExpansion}
              onToggleProjectExpansion={onToggleProjectExpansion}
              onTogglePRDExpansion={onTogglePRDExpansion}
              onToggleEpicExpansion={onToggleEpicExpansion}
              onToggleStoryExpansion={onToggleStoryExpansion}
            />
          )}
        </div>
      </div>

      <CreateDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreatePage={handleCreatePage}
      />

      <div className="p-3 border-t border-gray-200">
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 hover:bg-gray-100" onClick={onAIToggle}>
          <span className="text-gray-600">✨</span>
          <span className="text-sm text-gray-900">AI 助手</span>
        </Button>
      </div>
    </div>
  )
}
