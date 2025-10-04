/**
 * 路由配置常量
 */

// ==================== 基础路由 ====================

export const ROUTES = {
  home: '/',
  dashboard: '/dashboard',
  editor: '/editor',
  teams: '/teams',
  projects: '/projects',
  inbox: '/inbox',
  shared: '/shared',
  settings: '/settings',
  profile: '/profile',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
} as const

// ==================== 动态路由 ====================

export const DYNAMIC_ROUTES = {
  team: (teamId: string) => `/teams/${teamId}`,
  project: (teamId: string, projectId: string) => `/teams/${teamId}/projects/${projectId}`,
  prd: (teamId: string, projectId: string, prdId: string) => 
    `/teams/${teamId}/projects/${projectId}/prds/${prdId}`,
  epic: (teamId: string, projectId: string, prdId: string, epicId: string) => 
    `/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}`,
  story: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => 
    `/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}`,
  task: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string, taskId: string) => 
    `/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}/tasks/${taskId}`,
  page: (pageId: string) => `/pages/${pageId}`,
  kanban: (boardId: string) => `/kanban/${boardId}`,
} as const

// ==================== API路由 ====================

export const API_ROUTES = {
  auth: {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    register: '/api/auth/register',
    refresh: '/api/auth/refresh',
    forgotPassword: '/api/auth/forgot-password',
    resetPassword: '/api/auth/reset-password',
  },
  users: {
    list: '/api/users',
    create: '/api/users',
    get: (id: string) => `/api/users/${id}`,
    update: (id: string) => `/api/users/${id}`,
    delete: (id: string) => `/api/users/${id}`,
    profile: '/api/users/profile',
  },
  teams: {
    list: '/api/teams',
    create: '/api/teams',
    get: (id: string) => `/api/teams/${id}`,
    update: (id: string) => `/api/teams/${id}`,
    delete: (id: string) => `/api/teams/${id}`,
    members: (id: string) => `/api/teams/${id}/members`,
  },
  projects: {
    list: (teamId: string) => `/api/teams/${teamId}/projects`,
    create: (teamId: string) => `/api/teams/${teamId}/projects`,
    get: (teamId: string, projectId: string) => `/api/teams/${teamId}/projects/${projectId}`,
    update: (teamId: string, projectId: string) => `/api/teams/${teamId}/projects/${projectId}`,
    delete: (teamId: string, projectId: string) => `/api/teams/${teamId}/projects/${projectId}`,
  },
  prds: {
    list: (teamId: string, projectId: string) => `/api/teams/${teamId}/projects/${projectId}/prds`,
    create: (teamId: string, projectId: string) => `/api/teams/${teamId}/projects/${projectId}/prds`,
    get: (teamId: string, projectId: string, prdId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}`,
    update: (teamId: string, projectId: string, prdId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}`,
    delete: (teamId: string, projectId: string, prdId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}`,
  },
  epics: {
    list: (teamId: string, projectId: string, prdId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics`,
    create: (teamId: string, projectId: string, prdId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics`,
    get: (teamId: string, projectId: string, prdId: string, epicId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}`,
    update: (teamId: string, projectId: string, prdId: string, epicId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}`,
    delete: (teamId: string, projectId: string, prdId: string, epicId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}`,
  },
  stories: {
    list: (teamId: string, projectId: string, prdId: string, epicId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories`,
    create: (teamId: string, projectId: string, prdId: string, epicId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories`,
    get: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}`,
    update: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}`,
    delete: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}`,
  },
  tasks: {
    list: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}/tasks`,
    create: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}/tasks`,
    get: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string, taskId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}/tasks/${taskId}`,
    update: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string, taskId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}/tasks/${taskId}`,
    delete: (teamId: string, projectId: string, prdId: string, epicId: string, storyId: string, taskId: string) => 
      `/api/teams/${teamId}/projects/${projectId}/prds/${prdId}/epics/${epicId}/stories/${storyId}/tasks/${taskId}`,
  },
  pages: {
    list: '/api/pages',
    create: '/api/pages',
    get: (id: string) => `/api/pages/${id}`,
    update: (id: string) => `/api/pages/${id}`,
    delete: (id: string) => `/api/pages/${id}`,
    search: '/api/pages/search',
  },
  kanban: {
    boards: '/api/kanban/boards',
    board: (id: string) => `/api/kanban/boards/${id}`,
    items: (boardId: string) => `/api/kanban/boards/${boardId}/items`,
    item: (boardId: string, itemId: string) => `/api/kanban/boards/${boardId}/items/${itemId}`,
    move: (boardId: string) => `/api/kanban/boards/${boardId}/move`,
  },
  upload: {
    image: '/api/upload/image',
    file: '/api/upload/file',
    avatar: '/api/upload/avatar',
  },
  notifications: {
    list: '/api/notifications',
    markAsRead: (id: string) => `/api/notifications/${id}/read`,
    markAllAsRead: '/api/notifications/read-all',
  },
} as const

// ==================== 路由守卫配置 ====================

export const ROUTE_GUARDS = {
  public: [ROUTES.login, ROUTES.register, ROUTES.forgotPassword, ROUTES.resetPassword],
  protected: [
    ROUTES.dashboard,
    ROUTES.editor,
    ROUTES.teams,
    ROUTES.projects,
    ROUTES.inbox,
    ROUTES.shared,
    ROUTES.settings,
    ROUTES.profile,
  ],
  admin: [ROUTES.settings],
} as const

// ==================== 面包屑配置 ====================

export const BREADCRUMB_CONFIG = {
  teams: { label: '团队', icon: '👥' },
  projects: { label: '项目', icon: '📁' },
  prds: { label: 'PRD', icon: '📋' },
  epics: { label: 'Epic', icon: '🎯' },
  stories: { label: 'Story', icon: '📝' },
  tasks: { label: 'Task', icon: '✅' },
  pages: { label: '页面', icon: '📄' },
  kanban: { label: '看板', icon: '📋' },
} as const
