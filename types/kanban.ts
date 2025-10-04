/**
 * Kanban相关的类型定义
 */

import type { ID, Priority, TaskStatus, User } from './index'

// ==================== Kanban基础类型 ====================

export interface KanbanColumn {
  id: ID
  title: string
  status: TaskStatus
  items: KanbanItem[]
  color?: string
  isCollapsed?: boolean
  maxItems?: number
  wipLimit?: number
}

export interface KanbanItem {
  id: ID
  title: string
  description?: string
  status: TaskStatus
  priority: Priority
  assignee?: User
  dueDate?: string
  estimatedHours?: number
  actualHours?: number
  tags: string[]
  createdAt: string
  updatedAt: string
  dependencies?: ID[]
  subtasks?: KanbanItem[]
  attachments?: Attachment[]
  comments?: Comment[]
  metadata?: Record<string, unknown>
}

export interface Attachment {
  id: ID
  name: string
  url: string
  type: string
  size: number
  uploadedAt: string
  uploadedBy: User
}

export interface Comment {
  id: ID
  content: string
  author: User
  createdAt: string
  updatedAt?: string
  isEdited?: boolean
}

// ==================== 拖拽相关 ====================

export interface DragResult {
  draggableId: ID
  source: DropLocation
  destination?: DropLocation
  reason: 'DROP' | 'CANCEL'
}

export interface DropLocation {
  droppableId: ID
  index: number
}

export interface DragState {
  isDragging: boolean
  draggedItem?: KanbanItem
  dragOverColumn?: ID
  dragOverItem?: ID
}

// ==================== 过滤器 ====================

export interface KanbanFilter {
  assignee?: ID[]
  priority?: Priority[]
  tags?: string[]
  dueDate?: {
    start?: string
    end?: string
  }
  status?: TaskStatus[]
  search?: string
}

export interface KanbanView {
  id: ID
  name: string
  description?: string
  columns: KanbanColumn[]
  filters?: KanbanFilter
  sorting?: KanbanSorting
  grouping?: KanbanGrouping
  isDefault?: boolean
}

export interface KanbanSorting {
  field: keyof KanbanItem
  order: 'asc' | 'desc'
}

export interface KanbanGrouping {
  field: keyof KanbanItem
  enabled: boolean
}

// ==================== 统计和分析 ====================

export interface KanbanStats {
  totalItems: number
  completedItems: number
  inProgressItems: number
  overdueItems: number
  averageCompletionTime: number
  throughput: number
  cycleTime: number
  leadTime: number
}

export interface ColumnStats {
  columnId: ID
  itemCount: number
  averageAge: number
  oldestItem?: KanbanItem
  newestItem?: KanbanItem
}

export interface VelocityData {
  period: string
  completed: number
  planned: number
  actual: number
}

// ==================== AI分析 ====================

export interface AIProgressSummary {
  summary: string
  insights: string[]
  recommendations: string[]
  risks: string[]
  metrics: {
    completionRate: number
    velocity: number
    bottlenecks: string[]
    teamPerformance: Record<string, number>
  }
}

export interface AIInsight {
  type: 'bottleneck' | 'risk' | 'opportunity' | 'trend'
  title: string
  description: string
  severity: 'low' | 'medium' | 'high'
  confidence: number
  suggestedActions: string[]
}

// ==================== 依赖关系 ====================

export interface DependencyRelation {
  id: ID
  fromItem: ID
  toItem: ID
  type: 'blocks' | 'blocks-by' | 'relates' | 'duplicates'
  description?: string
}

export interface DependencyGraph {
  nodes: DependencyNode[]
  edges: DependencyEdge[]
}

export interface DependencyNode {
  id: ID
  type: 'item' | 'column'
  data: KanbanItem | KanbanColumn
}

export interface DependencyEdge {
  id: ID
  source: ID
  target: ID
  type: string
  data: DependencyRelation
}

// ==================== 模板 ====================

export interface KanbanTemplate {
  id: ID
  name: string
  description: string
  columns: Omit<KanbanColumn, 'items'>[]
  defaultFilters?: KanbanFilter
  defaultSorting?: KanbanSorting
  isPublic: boolean
  createdBy: User
  createdAt: string
}

// ==================== 事件 ====================

export interface KanbanEvent {
  type: 'item-moved' | 'item-created' | 'item-updated' | 'item-deleted' | 'column-updated'
  itemId?: ID
  columnId?: ID
  data?: unknown
  timestamp: string
  userId: ID
}

// ==================== 导出类型 ====================

export type KanbanBoard = {
  id: ID
  name: string
  description?: string
  columns: KanbanColumn[]
  views: KanbanView[]
  currentView?: ID
  filters?: KanbanFilter
  sorting?: KanbanSorting
  stats?: KanbanStats
  templates?: KanbanTemplate[]
}
