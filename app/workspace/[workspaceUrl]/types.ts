// ─── Legacy types (used by constants.ts mock data) ───────────────────────────

export type Priority = 'P0' | 'P1' | 'P2'
export type Status = 'Todo' | 'In Progress' | 'Review' | 'Done' | 'Backlog'

export interface User {
  id: string
  name: string
  avatar: string
  initials: string
}

export interface Task {
  id: string
  title: string
  status: Status
  assignee: User
  priority: Priority
  updatedAt: string
  description?: string
  subtasks?: string[]
  projectId?: string
}

export interface Notification {
  id: string
  type:
    | 'mention'
    | 'review_request'
    | 'assignment'
    | 'comment'
    | 'status_change'
    | 'merge'
  user: User
  targetId: string
  content?: string
  timestamp: string
  isUnread: boolean
  metadata?: {
    branch?: string
    additions?: number
    deletions?: number
  }
}

// ─── API types ────────────────────────────────────────────────────────────────

export type ApiPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type ApiStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'

export type Page = 'my-tasks' | 'projects' | 'project-detail'

export interface WorkspaceMemberInfo {
  id: string
  clerkId: string
  role: string
  name: string
  imageUrl: string | null
}

export interface MyTask {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  project: { id: string; name: string }
  parentTaskId: string | null
  assigneeId: string | null
  updatedAt: string
  viewOrder: number | null
  number: number
  teamIdentifier: string
}

export interface ApiProject {
  id: string
  name: string
  description: string | null
  isIdea: boolean
  updatedAt: string
  createdAt: string
  _count: { tasks: number }
  inProgressCount: number
  kanbanViewId?: string
}

export interface ApiTask {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  parentTaskId: string | null
  assigneeId: string | null
  updatedAt: string
  viewOrder: number | null
  number: number
  teamIdentifier: string
}

export interface TaskDetail {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  project: { id: string; name: string }
  parentTaskId: string | null
  assigneeId: string | null
  assignee: { id: string; clerkId: string } | null
  description: string | null
  updatedAt: string
  number: number
  teamIdentifier: string
}
