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

export type ProjectStatus = 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled'

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

export type StoryStatus = 'backlog' | 'ready' | 'in-progress' | 'review' | 'done'

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

export interface Block {
  id: string
  type: BlockType
  content: string
  metadata?: Record<string, any>
  order: number
}

export type BlockType = 'text' | 'heading' | 'list' | 'code' | 'image' | 'quote' | 'divider'

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
export type AgentStatus = 'active' | 'thinking' | 'reviewing' | 'idle' | 'offline'

export interface AgentRecommendation {
  agentId: string
  reason: string
  confidence: number // 0-100
  taskType: string
}

// 质量检查类型
export interface QualityCheck {
  id: string
  name: string
  description: string
  required: boolean
  passed: boolean
  message?: string
  category: QualityCategory
}

export type QualityCategory = 'completeness' | 'clarity' | 'feasibility' | 'consistency'

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

// 表单和验证类型
export interface ValidationError {
  field: string
  message: string
}

export interface FormState<T = any> {
  data: T
  errors: ValidationError[]
  isSubmitting: boolean
  isValid: boolean
}

// 事件类型
export interface BaseEvent {
  id: string
  type: string
  timestamp: Date
  userId?: string
}

export interface PageEvent extends BaseEvent {
  type: 'page.created' | 'page.updated' | 'page.deleted'
  pageId: string
}

export interface StoryEvent extends BaseEvent {
  type: 'story.created' | 'story.updated' | 'story.deleted' | 'story.status-changed'
  storyId: string
  epicId?: string
}

export interface TaskEvent extends BaseEvent {
  type: 'task.created' | 'task.updated' | 'task.deleted' | 'task.status-changed'
  taskId: string
  storyId?: string
}

export type AppEvent = PageEvent | StoryEvent | TaskEvent

// 通知类型
export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  read: boolean
  userId: string
  relatedId?: string
  relatedType?: string
  createdAt: Date
}

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

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

// UI 相关类型
export type ViewType = 'document' | 'teams' | 'shared'
export type ViewMode = 'list' | 'grid' | 'kanban'

export interface ContextMenuState {
  show: boolean
  position: { x: number; y: number }
  onRename: () => void
  onDelete: () => void
}

export interface DeleteDialogState {
  show: boolean
  itemType: string
  itemName: string
  onConfirm: () => void
  onCancel: () => void
}

// 导出所有类型的联合类型
export type EntityId = string
export type Timestamp = Date
export type EntityWithTimestamps = {
  createdAt: Timestamp
  updatedAt: Timestamp
}