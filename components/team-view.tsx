"use client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import KanbanBoard from "./kanban-board"
import MetadataPanel from "./metadata-panel"
import { useState } from "react"
import type { Team, Project, PRD, Epic, Story, Task } from "../hooks/use-teams"

interface TeamViewProps {
  teams: Record<string, Team>
  currentTeamId: string
  currentProjectId: string
  currentPRDId: string
  currentEpicId: string
  currentStoryId: string
  currentTaskId: string
  viewMode: "document" | "kanban"
  onViewModeChange: (mode: "document" | "kanban") => void
  onStatusChange: (itemId: string, newStatus: string) => void
}

export default function TeamView({
  teams,
  currentTeamId,
  currentProjectId,
  currentPRDId,
  currentEpicId,
  currentStoryId,
  currentTaskId,
  viewMode,
  onViewModeChange,
  onStatusChange,
}: TeamViewProps) {
  const [showMetadataPanel, setShowMetadataPanel] = useState(false)

  const getCurrentContent = () => {
    const team = teams[currentTeamId]
    if (!team) return null

    if (currentTaskId) {
      const project = team.projects.find((p) => p.id === currentProjectId)
      const prd = project?.prds.find((p) => p.id === currentPRDId)
      const epic = prd?.epics.find((e) => e.id === currentEpicId)
      const story = epic?.stories.find((s) => s.id === currentStoryId)
      const task = story?.tasks.find((t) => t.id === currentTaskId)
      return { type: "task", item: task }
    }

    if (currentStoryId) {
      const project = team.projects.find((p) => p.id === currentProjectId)
      const prd = project?.prds.find((p) => p.id === currentPRDId)
      const epic = prd?.epics.find((e) => e.id === currentEpicId)
      const story = epic?.stories.find((s) => s.id === currentStoryId)
      return { type: "story", item: story }
    }

    if (currentEpicId) {
      const project = team.projects.find((p) => p.id === currentProjectId)
      const prd = project?.prds.find((p) => p.id === currentPRDId)
      const epic = prd?.epics.find((e) => e.id === currentEpicId)
      return { type: "epic", item: epic }
    }

    if (currentPRDId) {
      const project = team.projects.find((p) => p.id === currentProjectId)
      const prd = project?.prds.find((p) => p.id === currentPRDId)
      return { type: "prd", item: prd }
    }

    if (currentProjectId) {
      const project = team.projects.find((p) => p.id === currentProjectId)
      return { type: "project", item: project }
    }

    return { type: "team", item: team }
  }

  const getMetadataItem = () => {
    const content = getCurrentContent()
    if (!content || !content.item) return null

    const { type, item } = content
    const baseItem = {
      id: (item as any).id,
      title: (item as any).title || (item as any).name,
      type: type as "team" | "project" | "prd" | "epic" | "story" | "task",
      status: (item as any).status,
      createdAt: (item as any).createdAt,
      updatedAt: (item as any).updatedAt,
      description: (item as any).description || (item as any).content,
    }

    if (type === "task") {
      return {
        ...baseItem,
        assignee: (item as Task).assignee,
        dueDate: (item as Task).dueDate,
      }
    }

    if (type === "story") {
      return {
        ...baseItem,
        priority: (item as Story).priority,
      }
    }

    if (type === "prd") {
      return {
        ...baseItem,
        version: (item as PRD).version,
      }
    }

    return baseItem
  }

  const getKanbanItems = () => {
    const content = getCurrentContent()
    if (!content) return []

    switch (content.type) {
      case "project":
        const project = content.item as Project
        return project.prds.map((prd) => ({
          id: prd.id,
          title: prd.title,
          status: prd.status,
          updatedAt: prd.updatedAt,
          type: "prd" as const,
          content: prd.content.substring(0, 100),
        }))

      case "prd":
        const prd = content.item as PRD
        return prd.epics.map((epic) => ({
          id: epic.id,
          title: epic.title,
          status: epic.status,
          updatedAt: epic.updatedAt,
          type: "epic" as const,
          content: epic.content,
        }))

      case "epic":
        const epic = content.item as Epic
        return epic.stories.map((story) => ({
          id: story.id,
          title: story.title,
          status: story.status,
          priority: story.priority,
          updatedAt: story.updatedAt,
          type: "story" as const,
          content: story.content,
        }))

      case "story":
        const story = content.item as Story
        return story.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          assignee: task.assignee || undefined,
          dueDate: task.dueDate || undefined,
          updatedAt: task.updatedAt,
          type: "task" as const,
          content: task.content,
        }))

      default:
        return []
    }
  }

  const content = getCurrentContent()
  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <span className="text-6xl text-gray-400 mb-4 block">👥</span>
          <h3 className="text-lg font-medium text-gray-900 mb-2">选择一个团队项目</h3>
          <p className="text-gray-500">从左侧导航栏选择团队、项目或文档来查看详细内容</p>
        </div>
      </div>
    )
  }

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      // Team statuses
      active: { color: "bg-green-100 text-green-800", label: "活跃" },
      "on-hold": { color: "bg-yellow-100 text-yellow-800", label: "暂停" },
      completed: { color: "bg-blue-100 text-blue-800", label: "已完成" },
      archived: { color: "bg-gray-100 text-gray-800", label: "已归档" },

      // PRD statuses
      draft: { color: "bg-gray-100 text-gray-800", label: "草稿" },
      review: { color: "bg-yellow-100 text-yellow-800", label: "评审中" },
      approved: { color: "bg-green-100 text-green-800", label: "已批准" },

      // Epic/Story/Task statuses
      planning: { color: "bg-blue-100 text-blue-800", label: "规划中" },
      backlog: { color: "bg-gray-100 text-gray-800", label: "待办" },
      "in-progress": { color: "bg-yellow-100 text-yellow-800", label: "进行中" },
      done: { color: "bg-green-100 text-green-800", label: "已完成" },
      todo: { color: "bg-gray-100 text-gray-800", label: "待办" },
    }

    const config = statusConfig[status as keyof typeof statusConfig] || {
      color: "bg-gray-100 text-gray-800",
      label: status,
    }
    return <Badge className={`${config.color} border-0`}>{config.label}</Badge>
  }

  const supportsKanban = ["project", "prd", "epic", "story"].includes(content.type)
  const kanbanItems = getKanbanItems()

  const renderViewModeToggle = () => {
    if (!supportsKanban) return null

    return (
      <div className="flex items-center gap-2">
        <Toggle
          pressed={viewMode === "document"}
          onPressedChange={() => onViewModeChange("document")}
          aria-label="文档模式"
          size="sm"
        >
          <span className="mr-1">📄</span>
          文档模式
        </Toggle>
        <Toggle
          pressed={viewMode === "kanban"}
          onPressedChange={() => onViewModeChange("kanban")}
          aria-label="看板模式"
          size="sm"
        >
          <span className="mr-1">📋</span>
          看板模式
        </Toggle>
      </div>
    )
  }

  const renderContent = () => {
    const { type, item } = content

    if (supportsKanban && viewMode === "kanban") {
      return (
        <div className="p-6 h-full">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{(item as any).title || (item as any).name}</h1>
              <p className="text-gray-600">看板视图</p>
            </div>
            <div className="flex items-center gap-2">
              {renderViewModeToggle()}
              <Button variant="outline" size="sm" onClick={() => setShowMetadataPanel(!showMetadataPanel)}>
                <span className="mr-2">📊</span>
                Meta Data
              </Button>
            </div>
          </div>

          <KanbanBoard
            items={kanbanItems}
            onStatusChange={onStatusChange}
            type={type as "project" | "prd" | "epic" | "story"}
          />
        </div>
      )
    }

    switch (type) {
      case "team":
        const team = item as Team
        return (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{team.name}</h1>
                <p className="text-gray-600">{team.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-800 border-0">{team.members.length} 成员</Badge>
                <Button variant="outline" size="sm">
                  <span className="mr-2">👥</span>
                  管理成员
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowMetadataPanel(!showMetadataPanel)}>
                  <span className="mr-2">📊</span>
                  Meta Data
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-blue-600">📊</span>
                  <span className="font-medium text-gray-900">项目总数</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">{team.projects.length}</div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-green-600">✅</span>
                  <span className="font-medium text-gray-900">已完成项目</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {team.projects.filter((p) => p.status === "completed").length}
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-yellow-600">⏰</span>
                  <span className="font-medium text-gray-900">进行中项目</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {team.projects.filter((p) => p.status === "active").length}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">项目列表</h2>
              <div className="space-y-3">
                {team.projects.map((project) => (
                  <div key={project.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-gray-900">{project.title}</h3>
                      {getStatusBadge(project.status)}
                    </div>
                    <p className="text-gray-600 text-sm mb-2">{project.description}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>PRD: {project.prds.length}</span>
                      <span>创建时间: {new Date(project.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      case "project":
        const project = item as Project
        return (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{project.title}</h1>
                <p className="text-gray-600">{project.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {renderViewModeToggle()}
                {getStatusBadge(project.status)}
                <Button variant="outline" size="sm">
                  编辑项目
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowMetadataPanel(!showMetadataPanel)}>
                  <span className="mr-2">📊</span>
                  Meta Data
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-blue-600">📅</span>
                  <span className="font-medium text-gray-900">创建时间</span>
                </div>
                <div className="text-lg text-gray-900">{new Date(project.createdAt).toLocaleDateString()}</div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-green-600">📊</span>
                  <span className="font-medium text-gray-900">PRD 数量</span>
                </div>
                <div className="text-lg text-gray-900">{project.prds.length}</div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">PRD 列表</h2>
              {project.prds.length > 0 ? (
                <div className="space-y-3">
                  {project.prds.map((prd) => (
                    <div key={prd.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{prd.title}</h3>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-gray-100 text-gray-800 border-0">{prd.version}</Badge>
                          {getStatusBadge(prd.status)}
                        </div>
                      </div>
                      <p className="text-gray-600 text-sm mb-2">{prd.content.substring(0, 100)}...</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Epic: {prd.epics.length}</span>
                        <span>更新时间: {new Date(prd.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <span className="text-6xl text-gray-400 mb-4 block">⚠️</span>
                  <p className="text-gray-500">暂无 PRD 文档</p>
                </div>
              )}
            </div>
          </div>
        )

      case "prd":
        const prd = item as PRD
        return (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{prd.title}</h1>
                <div className="flex items-center gap-2">
                  <Badge className="bg-gray-100 text-gray-800 border-0">{prd.version}</Badge>
                  {getStatusBadge(prd.status)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {renderViewModeToggle()}
                <Button variant="outline" size="sm">
                  编辑 PRD
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowMetadataPanel(!showMetadataPanel)}>
                  <span className="mr-2">📊</span>
                  Meta Data
                </Button>
              </div>
            </div>

            <div className="prose max-w-none mb-8">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-700">{prd.content}</p>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Epic 列表</h2>
              {prd.epics.length > 0 ? (
                <div className="space-y-3">
                  {prd.epics.map((epic) => (
                    <div key={epic.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{epic.title}</h3>
                        {getStatusBadge(epic.status)}
                      </div>
                      <p className="text-gray-600 text-sm mb-2">{epic.content}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Story: {epic.stories.length}</span>
                        <span>更新时间: {new Date(epic.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <span className="text-6xl text-gray-400 mb-4 block">⚠️</span>
                  <p className="text-gray-500">暂无 Epic</p>
                </div>
              )}
            </div>
          </div>
        )

      case "epic":
        const epic = item as Epic
        return (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{epic.title}</h1>
                {getStatusBadge(epic.status)}
              </div>
              <div className="flex items-center gap-2">
                {renderViewModeToggle()}
                <Button variant="outline" size="sm">
                  编辑 Epic
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowMetadataPanel(!showMetadataPanel)}>
                  <span className="mr-2">📊</span>
                  Meta Data
                </Button>
              </div>
            </div>

            <div className="prose max-w-none mb-8">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-700">{epic.content}</p>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Story 列表</h2>
              {epic.stories.length > 0 ? (
                <div className="space-y-3">
                  {epic.stories.map((story) => (
                    <div key={story.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{story.title}</h3>
                        <div className="flex items-center gap-2">
                          <Badge
                            className={`border-0 ${
                              story.priority === "high"
                                ? "bg-red-100 text-red-800"
                                : story.priority === "medium"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-green-100 text-green-800"
                            }`}
                          >
                            {story.priority === "high" ? "高" : story.priority === "medium" ? "中" : "低"}
                          </Badge>
                          {getStatusBadge(story.status)}
                        </div>
                      </div>
                      <p className="text-gray-600 text-sm mb-2">{story.content}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Task: {story.tasks.length}</span>
                        <span>更新时间: {new Date(story.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <span className="text-6xl text-gray-400 mb-4 block">⚠️</span>
                  <p className="text-gray-500">暂无 Story</p>
                </div>
              )}
            </div>
          </div>
        )

      case "story":
        const story = item as Story
        return (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{story.title}</h1>
                <div className="flex items-center gap-2">
                  <Badge
                    className={`border-0 ${
                      story.priority === "high"
                        ? "bg-red-100 text-red-800"
                        : story.priority === "medium"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-green-100 text-green-800"
                    }`}
                  >
                    {story.priority === "high" ? "高优先级" : story.priority === "medium" ? "中优先级" : "低优先级"}
                  </Badge>
                  {getStatusBadge(story.status)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {renderViewModeToggle()}
                <Button variant="outline" size="sm">
                  编辑 Story
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowMetadataPanel(!showMetadataPanel)}>
                  <span className="mr-2">📊</span>
                  Meta Data
                </Button>
              </div>
            </div>

            <div className="prose max-w-none mb-8">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-700">{story.content}</p>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Task 列表</h2>
              {story.tasks.length > 0 ? (
                <div className="space-y-3">
                  {story.tasks.map((task) => (
                    <div key={task.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{task.title}</h3>
                        {getStatusBadge(task.status)}
                      </div>
                      <p className="text-gray-600 text-sm mb-2">{task.content}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        {task.assignee && <span>负责人: {task.assignee}</span>}
                        {task.dueDate && <span>截止时间: {new Date(task.dueDate).toLocaleDateString()}</span>}
                        <span>更新时间: {new Date(task.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <span className="text-6xl text-gray-400 mb-4 block">⚠️</span>
                  <p className="text-gray-500">暂无 Task</p>
                </div>
              )}
            </div>
          </div>
        )

      case "task":
        const task = item as Task
        return (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{task.title}</h1>
                {getStatusBadge(task.status)}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  编辑 Task
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowMetadataPanel(!showMetadataPanel)}>
                  <span className="mr-2">📊</span>
                  Meta Data
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {task.assignee && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-600">👤</span>
                    <span className="font-medium text-gray-900">负责人</span>
                  </div>
                  <div className="text-lg text-gray-900">{task.assignee}</div>
                </div>
              )}

              {task.dueDate && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-600">📅</span>
                    <span className="font-medium text-gray-900">截止时间</span>
                  </div>
                  <div className="text-lg text-gray-900">{new Date(task.dueDate).toLocaleDateString()}</div>
                </div>
              )}
            </div>

            <div className="prose max-w-none">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">任务描述</h3>
                <p className="text-gray-700">{task.content}</p>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const metadataItem = getMetadataItem()

  return (
    <div className="flex-1 bg-white overflow-auto flex">
      <div className={`${showMetadataPanel ? "flex-1" : "w-full"} overflow-auto`}>{renderContent()}</div>

      {showMetadataPanel && metadataItem && (
        <MetadataPanel item={metadataItem} onClose={() => setShowMetadataPanel(false)} />
      )}
    </div>
  )
}
