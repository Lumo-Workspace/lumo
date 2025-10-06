/**
 * API 相关类型定义
 * API related type definitions
 */

import { 
  User, 
  Team, 
  Project, 
  PRD, 
  Epic, 
  Story, 
  Task, 
  Page, 
  Agent,
  ApiResponse,
  PaginatedResponse,
  SearchFilters,
  SortOptions
} from './index'

// API 端点类型
export type ApiEndpoint = 
  | 'users'
  | 'teams'
  | 'projects'
  | 'prds'
  | 'epics'
  | 'stories'
  | 'tasks'
  | 'pages'
  | 'agents'
  | 'notifications'
  | 'search'

// HTTP 方法类型
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// API 请求配置
export interface ApiRequestConfig {
  method: HttpMethod
  endpoint: ApiEndpoint
  params?: Record<string, any>
  body?: any
  headers?: Record<string, string>
  timeout?: number
}

// 分页参数
export interface PaginationParams {
  page?: number
  limit?: number
  sort?: SortOptions
  filters?: SearchFilters
}

// 用户 API 类型
export interface CreateUserRequest {
  name: string
  email: string
  role: User['role']
  avatar?: string
}

export interface UpdateUserRequest extends Partial<CreateUserRequest> {
  id: string
}

export type UsersResponse = PaginatedResponse<User>
export type UserResponse = ApiResponse<User>

// 团队 API 类型
export interface CreateTeamRequest {
  name: string
  description?: string
  memberIds?: string[]
}

export interface UpdateTeamRequest extends Partial<CreateTeamRequest> {
  id: string
}

export interface AddTeamMemberRequest {
  teamId: string
  userId: string
  role: Team['members'][0]['role']
}

export type TeamsResponse = PaginatedResponse<Team>
export type TeamResponse = ApiResponse<Team>

// 项目 API 类型
export interface CreateProjectRequest {
  name: string
  description?: string
  teamId: string
}

export interface UpdateProjectRequest extends Partial<CreateProjectRequest> {
  id: string
  status?: Project['status']
}

export type ProjectsResponse = PaginatedResponse<Project>
export type ProjectResponse = ApiResponse<Project>

// PRD API 类型
export interface CreatePRDRequest {
  title: string
  description?: string
  projectId: string
}

export interface UpdatePRDRequest extends Partial<CreatePRDRequest> {
  id: string
  status?: PRD['status']
}

export type PRDsResponse = PaginatedResponse<PRD>
export type PRDResponse = ApiResponse<PRD>

// Epic API 类型
export interface CreateEpicRequest {
  title: string
  description?: string
  prdId: string
  priority: Epic['priority']
}

export interface UpdateEpicRequest extends Partial<CreateEpicRequest> {
  id: string
  status?: Epic['status']
}

export type EpicsResponse = PaginatedResponse<Epic>
export type EpicResponse = ApiResponse<Epic>

// Story API 类型
export interface CreateStoryRequest {
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: string[]
  epicId: string
  priority: Story['priority']
  estimatedPoints: number
  tags?: string[]
  dependencies?: string[]
  businessValue?: string
  technicalNotes?: string
}

export interface UpdateStoryRequest extends Partial<CreateStoryRequest> {
  id: string
  status?: Story['status']
  actualPoints?: number
  assignee?: string
}

export interface BulkUpdateStoriesRequest {
  storyIds: string[]
  updates: Partial<UpdateStoryRequest>
}

export type StoriesResponse = PaginatedResponse<Story>
export type StoryResponse = ApiResponse<Story>

// Task API 类型
export interface CreateTaskRequest {
  title: string
  description?: string
  storyId?: string
  priority: Task['priority']
  assignee?: string
  dueDate?: Date
  estimatedHours?: number
  tags?: string[]
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  id: string
  status?: Task['status']
  actualHours?: number
}

export interface BulkUpdateTasksRequest {
  taskIds: string[]
  updates: Partial<UpdateTaskRequest>
}

export type TasksResponse = PaginatedResponse<Task>
export type TaskResponse = ApiResponse<Task>

// Page API 类型
export interface CreatePageRequest {
  title: string
  content: string
  parentId?: string
  type: Page['type']
}

export interface UpdatePageRequest extends Partial<CreatePageRequest> {
  id: string
  status?: Page['status']
}

export type PagesResponse = PaginatedResponse<Page>
export type PageResponse = ApiResponse<Page>

// Agent API 类型
export interface UpdateAgentRequest {
  id: string
  status?: Agent['status']
  currentTask?: string
  workload?: number
  efficiency?: number
}

export type AgentsResponse = ApiResponse<Agent[]>
export type AgentResponse = ApiResponse<Agent>

// 搜索 API 类型
export interface SearchRequest {
  query: string
  types?: string[]
  filters?: SearchFilters
  pagination?: PaginationParams
}

export interface SearchResult {
  id: string
  type: string
  title: string
  description?: string
  score: number
  metadata?: Record<string, any>
}

export interface SearchResponse extends ApiResponse<SearchResult[]> {
  total: number
  took: number
  suggestions?: string[]
}

// 批量操作类型
export interface BulkOperationRequest {
  ids: string[]
  operation: 'delete' | 'update' | 'archive' | 'restore'
  data?: any
}

export interface BulkOperationResponse extends ApiResponse {
  successCount: number
  failureCount: number
  errors?: Array<{
    id: string
    error: string
  }>
}

// 文件上传类型
export interface FileUploadRequest {
  file: File
  type: 'avatar' | 'attachment' | 'document'
  metadata?: Record<string, any>
}

export interface FileUploadResponse extends ApiResponse {
  url: string
  filename: string
  size: number
  type: string
}

// 导出请求类型
export interface ExportRequest {
  type: 'stories' | 'tasks' | 'pages' | 'projects'
  format: 'csv' | 'xlsx' | 'pdf' | 'json'
  filters?: SearchFilters
  fields?: string[]
}

export interface ExportResponse extends ApiResponse {
  downloadUrl: string
  expiresAt: Date
}

// 导入请求类型
export interface ImportRequest {
  type: 'stories' | 'tasks' | 'pages' | 'projects'
  format: 'csv' | 'xlsx' | 'json'
  file: File
  mapping?: Record<string, string>
  options?: {
    skipDuplicates?: boolean
    updateExisting?: boolean
    validateOnly?: boolean
  }
}

export interface ImportResponse extends ApiResponse {
  successCount: number
  failureCount: number
  warnings?: string[]
  errors?: Array<{
    row: number
    field?: string
    message: string
  }>
}

// 统计和报告类型
export interface StatsRequest {
  type: 'project' | 'team' | 'user' | 'story' | 'task'
  timeRange: {
    start: Date
    end: Date
  }
  groupBy?: 'day' | 'week' | 'month'
  filters?: SearchFilters
}

export interface StatsResponse extends ApiResponse {
  data: Array<{
    period: string
    value: number
    metadata?: Record<string, any>
  }>
  summary: {
    total: number
    average: number
    trend: 'up' | 'down' | 'stable'
    change: number
  }
}

// WebSocket 事件类型
export interface WebSocketEvent {
  type: string
  data: any
  timestamp: Date
  userId?: string
}

export interface RealtimeUpdateEvent extends WebSocketEvent {
  type: 'entity.updated' | 'entity.created' | 'entity.deleted'
  entityType: string
  entityId: string
  changes?: Record<string, any>
}

// API 错误类型
export interface ApiError {
  code: string
  message: string
  details?: Record<string, any>
  timestamp: Date
}

export interface ValidationError {
  field: string
  code: string
  message: string
}

export interface ApiErrorResponse {
  success: false
  error: ApiError
  validationErrors?: ValidationError[]
}