/**
 * 统一的类型定义文件
 * 集中管理项目中所有的TypeScript类型定义
 */

// ==================== 基础类型 ====================

export type ID = string

export type Status = 'active' | 'thinking' | 'reviewing' | 'idle' | 'offline'

export type Priority = 'low' | 'medium' | 'high'

export type Role = 'PM' | 'UX' | 'Dev' | 'QA' | 'BA'

export type ViewMode = 'document' | 'kanban'

export type ViewType = 'editor' | 'inbox' | 'shared' | 'teams'

export type BlockType = 'text' | 'task' | 'heading' | 'list' | 'quote' | 'code' | 'divider' | 'mermaid'

export type TaskStatus = 'todo' | 'in-progress' | 'review' | 'done'

export type ModalMode = 'create' | 'edit'

// ==================== 用户和团队相关 ====================

export interface User {
  id: ID
  name: string
  email: string
  avatar?: string
  role: Role
  status: Status
  expertise: string[]
  workload: number // 0-100
  efficiency: number // 0-100
  lastActivity: string
  completedTasks: number
  pendingTasks: number
  collaborationScore: number // 0-100
}

export interface Team {
  id: ID
  name: string
  description: string
  members: User[]
  isExpanded: boolean
  projects: Project[]
}

// ==================== 项目管理相关 ====================

export interface Project {
  id: ID
  name: string
  description: string
  isExpanded: boolean
  prds: PRD[]
}

export interface PRD {
  id: ID
  title: string
  description: string
  isExpanded: boolean
  epics: Epic[]
}

export interface Epic {
  id: ID
  title: string
  description: string
  isExpanded: boolean
  stories: Story[]
}

export interface Story {
  id: ID
  title: string
  asA: string // "As a..."
  iWant: string // "I want..."
  soThat: string // "So that..."
  acceptanceCriteria: string[]
  priority: Priority
  estimatedPoints: number
  dependencies: string[]
  tags: string[]
  businessValue: string
  technicalNotes: string
  status: TaskStatus
  assignee?: User
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: ID
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignee?: User
  storyId?: ID
  dueDate?: string
  estimatedHours?: number
  actualHours?: number
  tags: string[]
  createdAt: string
  updatedAt: string
}

// ==================== 文档和编辑器相关 ====================

export interface DocumentBlock {
  id: ID
  type: BlockType
  content: string
  task?: TaskWidget
  metadata?: Record<string, unknown>
}

export interface TaskWidget {
  id: ID
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignee?: User
  dueDate?: string
  estimatedHours?: number
  actualHours?: number
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Page {
  id: ID
  title: string
  content: DocumentBlock[]
  parentId?: ID
  children: Page[]
  isExpanded: boolean
  createdAt: string
  updatedAt: string
}

// ==================== UI状态相关 ====================

export interface UIState {
  currentView: ViewType
  showAIChat: boolean
  aiChatFullscreen: boolean
  workspaceExpanded: boolean
  teamsExpanded: boolean
  editingPageId: ID | null
  editingTitle: string
  teamViewMode: ViewMode
  contextMenu: ContextMenuState
  deleteDialog: DeleteDialogState
}

export interface ContextMenuState {
  show: boolean
  x: number
  y: number
  pageId: ID
}

export interface DeleteDialogState {
  show: boolean
  pageId: ID
  pageTitle: string
}

// ==================== AI和协作相关 ====================

export interface Agent extends User {
  currentTask?: string
}

export interface AgentRecommendation {
  agentId: ID
  reason: string
  confidence: number
  taskType: string
}

export interface CommunicationLog {
  id: ID
  timestamp: string
  agentId: ID
  message: string
  type: 'info' | 'warning' | 'error' | 'success'
}

export interface AgentRequirement {
  agentId: ID
  requirement: string
  priority: Priority
  status: TaskStatus
}

// ==================== 质量检查相关 ====================

export interface QualityCheck {
  id: string
  name: string
  description: string
  passed: boolean
  required: boolean
  message?: string
}

export interface StoryData {
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: string[]
  priority: Priority
  estimatedPoints: number
  dependencies: string[]
  tags: string[]
  businessValue: string
  technicalNotes: string
}

// ==================== 通知相关 ====================

export interface Notification {
  id: ID
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  timestamp: string
  read: boolean
  actionUrl?: string
}

// ==================== 事件相关 ====================

export interface DragItem {
  id: ID
  type: string
  data: unknown
}

export interface SlashMenuState {
  show: boolean
  position: { x: number; y: number }
  items: SlashMenuItem[]
}

export interface SlashMenuItem {
  id: string
  title: string
  description: string
  icon: string
  action: () => void
}

// ==================== API响应相关 ====================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// ==================== 表单相关 ====================

export interface FormField<T = string> {
  value: T
  error?: string
  touched: boolean
  required?: boolean
}

export interface FormState<T extends Record<string, unknown>> {
  fields: Record<keyof T, FormField<T[keyof T]>>
  isValid: boolean
  isSubmitting: boolean
  isDirty: boolean
}

// ==================== 配置相关 ====================

export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  language: 'en' | 'zh'
  autoSave: boolean
  autoSaveInterval: number
  maxFileSize: number
  allowedFileTypes: string[]
}

// ==================== 工具类型 ====================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>

export type NonNullable<T> = T extends null | undefined ? never : T

// ==================== 事件处理器类型 ====================

export type EventHandler<T = Event> = (event: T) => void

export type ChangeHandler<T = string> = (value: T) => void

export type AsyncHandler<T = unknown, R = void> = (data: T) => Promise<R>

export type ValidationRule<T = unknown> = (value: T) => string | undefined

// ==================== 导出所有类型 ====================

export type * from './api'
export type * from './forms'
export type * from './kanban'
