/**
 * 核心业务类型定义
 * Core business type definitions
 */

// 用户和团队相关类型
export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  role: UserRole
  createdAt: Date
  updatedAt: Date
}

export type UserRole = 'admin' | 'manager' | 'member' | 'viewer'

export interface Team {
  id: string
  name: string
  description?: string
  members: TeamMember[]
  createdAt: Date
  updatedAt: Date
}

export interface TeamMember {
  userId: string
  role: TeamRole
  joinedAt: Date
}

export type TeamRole = 'owner' | 'admin' | 'member'

// 项目结构类型
export interface Project {
  id: string
  name: string
  description?: string
  teamId: string
  status: ProjectStatus
  createdAt: Date
  updatedAt: Date
}

export type ProjectStatus =
  | 'planning'
  | 'active'
  | 'on-hold'
  | 'completed'
  | 'cancelled'

export interface PRD {
  id: string
  title: string
  description?: string
  projectId: string
  status: PRDStatus
  createdAt: Date
  updatedAt: Date
}

export type PRDStatus = 'draft' | 'review' | 'approved' | 'archived'

export interface Epic {
  id: string
  title: string
  description?: string
  prdId: string
  priority: Priority
  status: EpicStatus
  createdAt: Date
  updatedAt: Date
}

export type EpicStatus = 'backlog' | 'in-progress' | 'review' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'critical'

// 用户故事和任务类型
export interface Story {
  id: string
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: string[]
  epicId: string
  priority: Priority
  status: StoryStatus
  estimatedPoints: number
  actualPoints?: number
  assignee?: string
  tags: string[]
  dependencies: string[]
  businessValue: string
  technicalNotes?: string
  createdAt: Date
  updatedAt: Date
}

export type StoryStatus =
  | 'backlog'
  | 'ready'
  | 'in-progress'
  | 'review'
  | 'done'

export interface Task {
  id: string
  title: string
  description?: string
  storyId?: string
  status: TaskStatus
  priority: Priority
  assignee?: string
  dueDate?: Date
  estimatedHours?: number
  actualHours?: number
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export type TaskStatus = 'draft' | 'todo' | 'in-progress' | 'review' | 'done'

// 文档和页面类型
export interface Page {
  id: string
  title: string
  content: string
  parentId?: string
  type: PageType
  status: PageStatus
  createdAt: Date
  updatedAt: Date
}

export type PageType = 'document' | 'note' | 'template'
export type PageStatus = 'draft' | 'published' | 'archived'

// AI 相关类型
export interface Agent {
  id: string
  name: string
  role: AgentRole
  avatar: string
  status: AgentStatus
  currentTask?: string
  expertise: string[]
  workload: number // 0-100
  efficiency: number // 0-100
  lastActivity: string
  completedTasks: number
  pendingTasks: number
  collaborationScore: number // 0-100
}

export type AgentRole = 'PM' | 'UX' | 'Dev' | 'QA' | 'BA'
export type AgentStatus =
  | 'active'
  | 'thinking'
  | 'reviewing'
  | 'idle'
  | 'offline'

// API 响应类型
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// 搜索和过滤类型
export interface SearchFilters {
  query?: string
  type?: string
  status?: string
  priority?: Priority
  assignee?: string
  tags?: string[]
  dateRange?: {
    start: Date
    end: Date
  }
}

export interface SortOptions {
  field: string
  direction: 'asc' | 'desc'
}
