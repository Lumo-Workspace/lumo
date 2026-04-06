// ─── API routes ───────────────────────────────────────────────────────────────

export const API = {
  tasks: {
    me: '/api/tasks/me',
    byId: (id: string) => `/api/tasks/${id}`,
    branch: (id: string) => `/api/tasks/${id}/branch`,
    comments: (taskId: string) => `/api/tasks/${taskId}/comments`,
    comment: (taskId: string, commentId: string) =>
      `/api/tasks/${taskId}/comments/${commentId}`,
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
    logo: '/api/workspaces/me/logo',
    members: '/api/workspaces/members',
    memberById: (id: string) => `/api/workspaces/members/${id}`,
    leaveWorkspace: '/api/workspaces/members/me',
  },
  invites: {
    list: '/api/invites',
    accept: (token: string) => `/api/invites/${token}/accept`,
    byToken: (token: string) => `/api/invites/${token}`,
    resend: (token: string) => `/api/invites/${token}/resend`,
  },
  notifications: {
    list: '/api/notifications',
    markAllRead: '/api/notifications',
    markOne: (id: string) => `/api/notifications/${id}`,
    respond: (id: string) => `/api/notifications/${id}/respond`,
  },
  github: {
    oauth: (workspaceUrl: string) =>
      `/api/github/oauth?workspaceUrl=${workspaceUrl}`,
    integration: '/api/github/integration',
    repos: '/api/github/repos',
    authorizedRepos: '/api/github/authorized-repos',
  },
  agent: {
    run: (taskId: string) => `/api/agent/run/${taskId}`,
    logs: (taskId: string) => `/api/agent/logs/${taskId}`,
    resume: (taskId: string) => `/api/agent/resume/${taskId}`,
    retry: '/api/agent/retry',
    status: (taskId: string) => `/api/agent/status/${taskId}`,
  },
  documents: {
    list: '/api/documents',
    byId: (id: string) => `/api/documents/${id}`,
    shares: (id: string) => `/api/documents/${id}/shares`,
    shareById: (id: string, shareId: string) =>
      `/api/documents/${id}/shares/${shareId}`,
    move: (id: string) => `/api/documents/${id}/move`,
  },
  slack: {
    oauth: (workspaceUrl: string) =>
      `/api/slack/oauth?workspaceUrl=${workspaceUrl}`,
    integration: (workspaceUrl: string) =>
      `/api/slack/integration?workspaceUrl=${workspaceUrl}`,
    channels: (workspaceUrl: string, projectId: string) =>
      `/api/slack/channels?workspaceUrl=${workspaceUrl}&projectId=${encodeURIComponent(projectId)}`,
    channelById: (id: string) => `/api/slack/channels/${id}`,
    availableChannels: (workspaceUrl: string) =>
      `/api/slack/available-channels?workspaceUrl=${workspaceUrl}`,
    createChannel: (workspaceUrl: string) =>
      `/api/slack/create-channel?workspaceUrl=${workspaceUrl}`,
  },
}

// ─── Local storage / cache keys ───────────────────────────────────────────────

export const CACHE_KEY = {
  preferences: 'lumo:preferences',
  tasks: 'lumo:tasks',
  myTasks: 'lumo:myTasks',
  comments: (taskId: string) => `lumo:comments:${taskId}`,
  description: (taskId: string) => `lumo:desc:${taskId}`,
  projects: 'lumo:projects',
  members: 'lumo:members',
  invites: 'lumo:invites',
  projectTasks: (projectId: string) => `lumo:projectTasks:${projectId}`,
  workspace: 'lumo:workspace',
  notifications: 'lumo:notifications',
  agentActors: 'lumo:agentActors',
  displayMyTasks: (userId: string) => `lumo:display:my-tasks:${userId}`,
  displayProject: (projectId: string) => `lumo:display:project:${projectId}`,
  documents: 'lumo:documents',
  documentDetail: (docId: string) => `lumo:doc:${docId}`,
}

// ─── Drag-and-drop ────────────────────────────────────────────────────────────

export const DND_ACTIVATION_DISTANCE = 8

// ─── Idea / draft badge ───────────────────────────────────────────────────────

export const IDEA_BADGE_CLS =
  'text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
