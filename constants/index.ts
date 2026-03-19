/**
 * 应用常量定义
 * Application constants
 */

// 应用基本信息
export const APP_CONFIG = {
  name: 'Lumo',
  version: '1.0.0',
  description: 'AI-Powered Document & Project Management Platform',
  author: 'Lumo Team',
  repository: 'https://github.com/lumoai/lumo',
} as const

// 路由路径常量
export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  DOCUMENTS: '/documents',
  PROJECTS: '/projects',
  TEAMS: '/teams',
  SETTINGS: '/settings',
  PROFILE: '/profile',
  LOGIN: '/signin',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
} as const

// API 端点常量
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/api/auth/login',
    LOGOUT: '/api/auth/logout',
    REGISTER: '/api/auth/register',
    REFRESH: '/api/auth/refresh',
    FORGOT_PASSWORD: '/api/auth/forgot-password',
    RESET_PASSWORD: '/api/auth/reset-password',
  },
  USERS: '/api/users',
  TEAMS: '/api/teams',
  PROJECTS: '/api/projects',
  PRDS: '/api/prds',
  EPICS: '/api/epics',
  STORIES: '/api/stories',
  TASKS: '/api/tasks',
  PAGES: '/api/pages',
  AGENTS: '/api/agents',
  SEARCH: '/api/search',
  UPLOAD: '/api/upload',
  EXPORT: '/api/export',
  IMPORT: '/api/import',
} as const

// 本地存储键名
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'lumo_auth_token',
  REFRESH_TOKEN: 'lumo_refresh_token',
  USER_PREFERENCES: 'lumo_user_preferences',
  THEME: 'lumo_theme',
  LANGUAGE: 'lumo_language',
  SIDEBAR_STATE: 'lumo_sidebar_state',
  DASHBOARD_LAYOUT: 'lumo_dashboard_layout',
  RECENT_PAGES: 'lumo_recent_pages',
  SEARCH_HISTORY: 'lumo_search_history',
} as const

// 主题相关常量
export const THEME = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const

// 语言支持
export const LANGUAGES = {
  EN: 'en',
  ZH: 'zh',
  ZH_CN: 'zh-CN',
  ZH_TW: 'zh-TW',
} as const

// 分页默认值
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  PAGE_SIZES: [10, 20, 50, 100],
} as const

// 文件上传限制
export const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: {
    IMAGES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    DOCUMENTS: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    SPREADSHEETS: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  },
} as const

// 公共邮箱域名列表
export const PUBLIC_EMAIL_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'yandex.com',
  'mail.com',
  'gmx.com',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
] as const

// 表单验证规则
export const VALIDATION = {
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PASSWORD_MIN_LENGTH: 8,
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 50,
  TITLE_MAX_LENGTH: 200,
  DESCRIPTION_MAX_LENGTH: 1000,
  CONTENT_MAX_LENGTH: 10000,
} as const

// 状态颜色映射
export const STATUS_COLORS = {
  DRAFT: '#6B7280',
  TODO: '#3B82F6',
  IN_PROGRESS: '#F59E0B',
  REVIEW: '#8B5CF6',
  DONE: '#10B981',
  CANCELLED: '#EF4444',
} as const

// 优先级颜色映射
export const PRIORITY_COLORS = {
  LOW: '#10B981',
  MEDIUM: '#F59E0B',
  HIGH: '#F97316',
  CRITICAL: '#EF4444',
} as const

// 角色权限映射
export const ROLE_PERMISSIONS = {
  ADMIN: ['read', 'write', 'delete', 'admin'],
  MANAGER: ['read', 'write', 'delete'],
  MEMBER: ['read', 'write'],
  VIEWER: ['read'],
} as const

// 通知类型配置
export const NOTIFICATION_TYPES = {
  INFO: {
    icon: 'info',
    color: '#3B82F6',
    duration: 5000,
  },
  SUCCESS: {
    icon: 'check-circle',
    color: '#10B981',
    duration: 3000,
  },
  WARNING: {
    icon: 'alert-triangle',
    color: '#F59E0B',
    duration: 7000,
  },
  ERROR: {
    icon: 'x-circle',
    color: '#EF4444',
    duration: 10000,
  },
} as const

// 日期格式常量
export const DATE_FORMATS = {
  SHORT: 'MMM dd, yyyy',
  LONG: 'MMMM dd, yyyy',
  TIME: 'HH:mm',
  DATETIME: 'MMM dd, yyyy HH:mm',
  ISO: 'yyyy-MM-dd',
  DISPLAY: 'dd/MM/yyyy',
} as const

// 搜索配置
export const SEARCH_CONFIG = {
  MIN_QUERY_LENGTH: 2,
  DEBOUNCE_DELAY: 300,
  MAX_SUGGESTIONS: 10,
  MAX_RESULTS: 100,
} as const

// 自动保存配置
export const AUTO_SAVE = {
  ENABLED: true,
  INTERVAL: 30000, // 30 seconds
  DEBOUNCE_DELAY: 1000, // 1 second
} as const

// 动画配置
export const ANIMATION = {
  DURATION: {
    FAST: 150,
    NORMAL: 300,
    SLOW: 500,
  },
  EASING: {
    EASE_IN: 'cubic-bezier(0.4, 0, 1, 1)',
    EASE_OUT: 'cubic-bezier(0, 0, 0.2, 1)',
    EASE_IN_OUT: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const

// 响应式断点
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536,
} as const

// 组件尺寸
export const SIZES = {
  XS: 'xs',
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
  XL: 'xl',
} as const

// 组件变体
export const VARIANTS = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  OUTLINE: 'outline',
  GHOST: 'ghost',
  DESTRUCTIVE: 'destructive',
} as const

// 拖拽相关常量
export const DRAG_AND_DROP = {
  TYPES: {
    TASK: 'task',
    STORY: 'story',
    PAGE: 'page',
  },
  EFFECTS: {
    MOVE: 'move',
    COPY: 'copy',
  },
} as const

// 快捷键配置
export const KEYBOARD_SHORTCUTS = {
  SAVE: 'Ctrl+S',
  NEW_PAGE: 'Ctrl+N',
  NEW_STORY: 'Ctrl+Shift+N',
  NEW_TASK: 'Ctrl+T',
  SEARCH: 'Ctrl+K',
  CLOSE: 'Escape',
  FULLSCREEN: 'F11',
  UNDO: 'Ctrl+Z',
  REDO: 'Ctrl+Y',
} as const

// 错误代码
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER_ERROR: 'SERVER_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const

// 质量检查规则
export const QUALITY_CHECKS = {
  STORY: {
    MIN_TITLE_LENGTH: 5,
    MIN_DESCRIPTION_LENGTH: 10,
    MIN_ACCEPTANCE_CRITERIA: 1,
    MAX_ESTIMATED_POINTS: 13,
  },
  TASK: {
    MIN_TITLE_LENGTH: 3,
    MIN_DESCRIPTION_LENGTH: 5,
    MAX_ESTIMATED_HOURS: 40,
  },
} as const

// 导出配置
export const EXPORT_CONFIG = {
  FORMATS: ['csv', 'xlsx', 'pdf', 'json'],
  MAX_RECORDS: 10000,
  CHUNK_SIZE: 1000,
} as const

// 导入配置
export const IMPORT_CONFIG = {
  FORMATS: ['csv', 'xlsx', 'json'],
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_RECORDS: 1000,
} as const

// WebSocket 事件类型
export const WS_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ERROR: 'error',
  ENTITY_UPDATED: 'entity.updated',
  ENTITY_CREATED: 'entity.created',
  ENTITY_DELETED: 'entity.deleted',
  NOTIFICATION: 'notification',
  COLLABORATION: 'collaboration',
} as const

// 缓存配置
export const CACHE_CONFIG = {
  TTL: {
    SHORT: 5 * 60 * 1000, // 5 minutes
    MEDIUM: 30 * 60 * 1000, // 30 minutes
    LONG: 24 * 60 * 60 * 1000, // 24 hours
  },
  KEYS: {
    USER_DATA: 'user_data',
    TEAM_DATA: 'team_data',
    PROJECT_DATA: 'project_data',
    SEARCH_RESULTS: 'search_results',
  },
} as const

// 性能监控配置
export const PERFORMANCE_CONFIG = {
  SAMPLE_RATE: 0.1, // 10% sampling
  MAX_METRICS: 1000,
  CLEANUP_INTERVAL: 5 * 60 * 1000, // 5 minutes
} as const

// 导出所有常量的类型
export type AppConfig = typeof APP_CONFIG
export type Routes = typeof ROUTES
export type ApiEndpoints = typeof API_ENDPOINTS
export type StorageKeys = typeof STORAGE_KEYS
export type Theme = typeof THEME
export type Languages = typeof LANGUAGES
export type Pagination = typeof PAGINATION
export type FileUpload = typeof FILE_UPLOAD
export type Validation = typeof VALIDATION
export type StatusColors = typeof STATUS_COLORS
export type PriorityColors = typeof PRIORITY_COLORS
export type RolePermissions = typeof ROLE_PERMISSIONS
export type NotificationTypes = typeof NOTIFICATION_TYPES
export type DateFormats = typeof DATE_FORMATS
export type SearchConfig = typeof SEARCH_CONFIG
export type AutoSave = typeof AUTO_SAVE
export type Animation = typeof ANIMATION
export type Breakpoints = typeof BREAKPOINTS
export type Sizes = typeof SIZES
export type Variants = typeof VARIANTS
export type DragAndDrop = typeof DRAG_AND_DROP
export type KeyboardShortcuts = typeof KEYBOARD_SHORTCUTS
export type ErrorCodes = typeof ERROR_CODES
export type QualityChecks = typeof QUALITY_CHECKS
export type ExportConfig = typeof EXPORT_CONFIG
export type ImportConfig = typeof IMPORT_CONFIG
export type WSEvents = typeof WS_EVENTS
export type CacheConfig = typeof CACHE_CONFIG
export type PerformanceConfig = typeof PERFORMANCE_CONFIG
