/**
 * 应用常量定义
 * 集中管理项目中所有的常量值
 */

import type { 
  Priority, 
  TaskStatus, 
  Role, 
  ViewMode, 
  ViewType, 
  BlockType,
  Status 
} from '@/types'

// ==================== 应用配置 ====================

export const APP_CONFIG = {
  name: 'Lumo',
  version: '1.0.0',
  description: 'AI-Powered Document & Project Management Platform',
  author: 'Lumo Team',
  repository: 'https://github.com/lumoai/lumo',
  supportEmail: 'support@lumo.ai',
} as const

// ==================== 主题配置 ====================

export const THEME_CONFIG = {
  light: {
    primary: '#0f172a',
    secondary: '#64748b',
    accent: '#3b82f6',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    muted: '#64748b',
  },
  dark: {
    primary: '#f8fafc',
    secondary: '#94a3b8',
    accent: '#60a5fa',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    muted: '#94a3b8',
  },
} as const

// ==================== 状态选项 ====================

export const STATUS_OPTIONS = {
  task: [
    { value: 'todo', label: '待办', color: 'bg-gray-500' },
    { value: 'in-progress', label: '进行中', color: 'bg-blue-500' },
    { value: 'review', label: '审查', color: 'bg-yellow-500' },
    { value: 'done', label: '完成', color: 'bg-green-500' },
  ] as const,
  agent: [
    { value: 'active', label: '活跃', color: 'bg-green-500' },
    { value: 'thinking', label: '思考中', color: 'bg-yellow-500' },
    { value: 'reviewing', label: '审查中', color: 'bg-blue-500' },
    { value: 'idle', label: '空闲', color: 'bg-gray-400' },
    { value: 'offline', label: '离线', color: 'bg-red-500' },
  ] as const,
} as const

// ==================== 优先级选项 ====================

export const PRIORITY_OPTIONS = [
  { value: 'low', label: '低', color: 'bg-green-500', icon: '↓' },
  { value: 'medium', label: '中', color: 'bg-yellow-500', icon: '→' },
  { value: 'high', label: '高', color: 'bg-red-500', icon: '↑' },
] as const

// ==================== 角色选项 ====================

export const ROLE_OPTIONS = [
  { value: 'PM', label: '产品经理', icon: '🎯', color: 'bg-purple-500' },
  { value: 'UX', label: '用户体验', icon: '🎨', color: 'bg-pink-500' },
  { value: 'Dev', label: '开发工程师', icon: '💻', color: 'bg-blue-500' },
  { value: 'QA', label: '质量保证', icon: '🔍', color: 'bg-orange-500' },
  { value: 'BA', label: '业务分析师', icon: '📊', color: 'bg-green-500' },
] as const

// ==================== 视图选项 ====================

export const VIEW_OPTIONS = {
  mode: [
    { value: 'document', label: '文档视图', icon: '📄' },
    { value: 'kanban', label: '看板视图', icon: '📋' },
  ] as const,
  type: [
    { value: 'editor', label: '编辑器', icon: '✏️' },
    { value: 'inbox', label: '收件箱', icon: '📥' },
    { value: 'shared', label: '共享', icon: '🔗' },
    { value: 'teams', label: '团队', icon: '👥' },
  ] as const,
} as const

// ==================== 块类型选项 ====================

export const BLOCK_TYPE_OPTIONS = [
  { value: 'text', label: '文本', icon: '📝', description: '普通文本块' },
  { value: 'heading', label: '标题', icon: '📌', description: '标题块' },
  { value: 'list', label: '列表', icon: '📋', description: '有序或无序列表' },
  { value: 'quote', label: '引用', icon: '💬', description: '引用块' },
  { value: 'code', label: '代码', icon: '💻', description: '代码块' },
  { value: 'task', label: '任务', icon: '✅', description: '任务块' },
  { value: 'mermaid', label: '图表', icon: '📊', description: 'Mermaid 图表' },
  { value: 'divider', label: '分割线', icon: '➖', description: '分割线' },
] as const

// ==================== 评估点数 ====================

export const ESTIMATION_POINTS = [
  { value: 1, label: '1 点', description: '非常简单，几分钟内完成' },
  { value: 2, label: '2 点', description: '简单，几小时内完成' },
  { value: 3, label: '3 点', description: '中等复杂度，1天内完成' },
  { value: 5, label: '5 点', description: '较复杂，2-3天内完成' },
  { value: 8, label: '8 点', description: '复杂，1周内完成' },
  { value: 13, label: '13 点', description: '非常复杂，需要拆分' },
] as const

// ==================== 标签预设 ====================

export const TAG_PRESETS = [
  { value: 'frontend', label: '前端', color: 'bg-blue-500' },
  { value: 'backend', label: '后端', color: 'bg-green-500' },
  { value: 'database', label: '数据库', color: 'bg-orange-500' },
  { value: 'ui', label: 'UI设计', color: 'bg-purple-500' },
  { value: 'ux', label: '用户体验', color: 'bg-pink-500' },
  { value: 'testing', label: '测试', color: 'bg-yellow-500' },
  { value: 'documentation', label: '文档', color: 'bg-gray-500' },
  { value: 'bug', label: 'Bug修复', color: 'bg-red-500' },
  { value: 'feature', label: '新功能', color: 'bg-indigo-500' },
  { value: 'refactor', label: '重构', color: 'bg-teal-500' },
] as const

// ==================== 通知类型 ====================

export const NOTIFICATION_TYPES = {
  info: { icon: 'ℹ️', color: 'bg-blue-500' },
  success: { icon: '✅', color: 'bg-green-500' },
  warning: { icon: '⚠️', color: 'bg-yellow-500' },
  error: { icon: '❌', color: 'bg-red-500' },
} as const

// ==================== 文件类型限制 ====================

export const FILE_CONFIG = {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/json',
    'text/markdown',
  ],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.txt', '.json', '.md'],
} as const

// ==================== 键盘快捷键 ====================

export const KEYBOARD_SHORTCUTS = {
  save: 'Cmd+S',
  newPage: 'Cmd+N',
  search: 'Cmd+K',
  toggleSidebar: 'Cmd+B',
  toggleTheme: 'Cmd+Shift+T',
  undo: 'Cmd+Z',
  redo: 'Cmd+Shift+Z',
  bold: 'Cmd+B',
  italic: 'Cmd+I',
  code: 'Cmd+E',
  link: 'Cmd+K',
} as const

// ==================== 本地存储键 ====================

export const STORAGE_KEYS = {
  theme: 'lumo-theme',
  language: 'lumo-language',
  sidebarExpanded: 'lumo-sidebar-expanded',
  teamsExpanded: 'lumo-teams-expanded',
  recentPages: 'lumo-recent-pages',
  userPreferences: 'lumo-user-preferences',
  workspaceLayout: 'lumo-workspace-layout',
} as const

// ==================== API配置 ====================

export const API_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || '/api',
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
} as const

// ==================== 分页配置 ====================

export const PAGINATION_CONFIG = {
  defaultPageSize: 20,
  pageSizeOptions: [10, 20, 50, 100],
  maxPageSize: 100,
} as const

// ==================== 自动保存配置 ====================

export const AUTO_SAVE_CONFIG = {
  enabled: true,
  interval: 2000, // 2 seconds
  debounceDelay: 500,
  maxRetries: 3,
} as const

// ==================== 动画配置 ====================

export const ANIMATION_CONFIG = {
  duration: {
    fast: 150,
    normal: 300,
    slow: 500,
  },
  easing: {
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} as const

// ==================== 验证规则 ====================

export const VALIDATION_RULES = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/.+/,
  phone: /^[\+]?[1-9][\d]{0,15}$/,
  username: /^[a-zA-Z0-9_]{3,20}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
} as const

// ==================== 默认值 ====================

export const DEFAULT_VALUES = {
  page: {
    title: 'Untitled',
    content: [{ id: '1', type: 'text', content: '' }],
  },
  story: {
    title: '',
    asA: '',
    iWant: '',
    soThat: '',
    acceptanceCriteria: [''],
    priority: 'medium' as Priority,
    estimatedPoints: 0,
    dependencies: [],
    tags: [],
    businessValue: '',
    technicalNotes: '',
  },
  task: {
    title: '',
    description: '',
    status: 'todo' as TaskStatus,
    priority: 'medium' as Priority,
    tags: [],
  },
  team: {
    name: '',
    description: '',
    members: [],
  },
} as const

// ==================== 导出所有常量 ====================

export * from './routes'
export * from './messages'
