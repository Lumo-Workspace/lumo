// ─── API routes ───────────────────────────────────────────────────────────────

export const API = {
  tasks: {
    me: '/api/tasks/me',
    byId: (id: string) => `/api/tasks/${id}`,
  },
  projects: {
    list: '/api/projects',
    byId: (id: string) => `/api/projects/${id}`,
    tasks: (projectId: string) => `/api/projects/${projectId}/tasks`,
  },
  views: {
    taskOrders: (viewId: string) => `/api/views/${viewId}/task-orders`,
  },
  workspaces: {
    me: '/api/workspaces/me',
    members: '/api/workspaces/members',
  },
  invites: {
    list: '/api/invites',
    accept: (token: string) => `/api/invites/${token}/accept`,
    byToken: (token: string) => `/api/invites/${token}`,
  },
}

// ─── Local storage / cache keys ───────────────────────────────────────────────

export const CACHE_KEY = {
  darkMode: 'lumo:darkMode',
  myTasks: 'lumo:myTasks',
  projects: 'lumo:projects',
  members: 'lumo:members',
  projectTasks: (projectId: string) => `lumo:projectTasks:${projectId}`,
}

// ─── Drag-and-drop ────────────────────────────────────────────────────────────

export const DND_ACTIVATION_DISTANCE = 8

// ─── Idea / draft badge ───────────────────────────────────────────────────────

export const IDEA_BADGE_CLS =
  'text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
