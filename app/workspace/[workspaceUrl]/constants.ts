// ─── API routes ───────────────────────────────────────────────────────────────

export const API = {
  tasks: {
    me: '/api/tasks/me',
    byId: (id: string) => `/api/tasks/${id}`,
    comments: (taskId: string) => `/api/tasks/${taskId}/comments`,
    comment: (taskId: string, commentId: string) =>
      `/api/tasks/${taskId}/comments/${commentId}`,
    timeline: (taskId: string) => `/api/tasks/${taskId}/timeline`,
    agentRuns: (taskId: string) => `/api/tasks/${taskId}/agent-runs`,
    lineage: (identifier: string) => `/api/tasks/lineage/${identifier}`,
    status: (identifier: string) => `/api/tasks/${identifier}/status`,
    forecast: (taskId: string) => `/api/tasks/${taskId}/forecast`,
    progress: (taskId: string) => `/api/tasks/${taskId}/progress`,
    boundaryCrossings: (taskId: string) =>
      `/api/tasks/${taskId}/boundary-crossings`,
    boundaryDisposition: (taskId: string) =>
      `/api/tasks/${taskId}/boundary-crossings/disposition`,
    boundaryRemediation: (taskId: string, crossingId: string) =>
      `/api/tasks/${taskId}/boundary-crossings/${crossingId}/remediation`,
    boundarySystemExplain: (taskId: string, crossingId: string) =>
      `/api/tasks/${taskId}/boundary-crossings/${crossingId}/system-explain`,
    // LUM-751: soft-revoke a repository suppression rule (Clerk-only).
    boundarySuppressionRule: (taskId: string, ruleId: string) =>
      `/api/tasks/${taskId}/boundary-crossings/suppression-rules/${ruleId}`,
    // LUM-759: read-only blast radius of a rule built from this crossing.
    boundarySuppressionPreview: (
      taskId: string,
      crossingId: string,
      scope: 'exact' | 'directory' = 'exact'
    ) =>
      `/api/tasks/${taskId}/boundary-crossings/${crossingId}/suppression-preview${
        scope === 'directory' ? '?scope=directory' : ''
      }`,
    quickDispatchParse: '/api/tasks/parse-quick-dispatch',
    quickDispatchExecute: '/api/tasks/quick-dispatch/execute',
    workspace: '/api/tasks/workspace',
    dependencies: (taskId: string) => `/api/tasks/${taskId}/dependencies`,
    dependency: (taskId: string, depId: string) =>
      `/api/tasks/${taskId}/dependencies/${depId}`,
  },
  projects: {
    list: '/api/projects',
    byId: (id: string) => `/api/projects/${id}`,
    tasks: (projectId: string) => `/api/projects/${projectId}/tasks`,
    reorder: '/api/projects/reorder',
  },
  views: {
    taskOrders: (viewId: string) => `/api/views/${viewId}/task-orders`,
  },
  workspaces: {
    me: '/api/workspaces/me',
    logo: '/api/workspaces/me/logo',
    members: '/api/workspaces/members',
    memberConnections: '/api/workspaces/members/connections',
    memberById: (id: string) => `/api/workspaces/members/${id}`,
    leaveWorkspace: '/api/workspaces/members/me',
    exports: '/api/workspaces/me/exports',
    deletion: '/api/workspaces/me/deletion',
    aiDerivedContent: '/api/workspaces/me/ai-derived-content',
    // LUM-1002: the PR security-scan switches (also `lumo workspace security-scan`).
    exportDownload: (id: string) =>
      `/api/workspaces/me/exports/${encodeURIComponent(id)}/download`,
    // LUM-907: the workspace audit log (OWNER only) and its CSV export.
    auditEvents: '/api/workspaces/me/audit-events',
    auditEventsExport: '/api/workspaces/me/audit-events/export',
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
  },
  github: {
    oauth: (workspaceUrl: string) =>
      `/api/github/oauth?workspaceUrl=${workspaceUrl}`,
    integration: '/api/github/integration',
    repos: '/api/github/repos',
    appInstall: (workspaceUrl: string) =>
      `/api/github/app/install?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
    appInstallation: (workspaceUrl: string) =>
      `/api/github/app/installation?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
    appReverify: (workspaceUrl: string) =>
      `/api/github/app/reverify?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
  },
  agent: {
    run: (taskId: string) => `/api/agent/run/${taskId}`,
    logs: (taskId: string) => `/api/agent/logs/${taskId}`,
    resume: (taskId: string) => `/api/agent/resume/${taskId}`,
    retry: '/api/agent/retry',
    status: (taskId: string) => `/api/agent/status/${taskId}`,
  },
  tags: {
    list: '/api/tags',
    byId: (id: string) => `/api/tags/${id}`,
  },
  // LUM-918: tasks / documents in the trash.
  trash: {
    list: '/api/trash',
    item: (kind: string, id: string) =>
      `/api/trash/${kind}/${encodeURIComponent(id)}`,
    restore: (kind: string, id: string) =>
      `/api/trash/${kind}/${encodeURIComponent(id)}/restore`,
  },
  documents: {
    list: '/api/documents',
    byId: (id: string) => `/api/documents/${id}`,
    shares: (id: string) => `/api/documents/${id}/shares`,
    shareById: (id: string, shareId: string) =>
      `/api/documents/${id}/shares/${shareId}`,
    move: (id: string) => `/api/documents/${id}/move`,
    tree: '/api/documents/tree',
    comments: (docId: string) => `/api/documents/${docId}/comments`,
    comment: (docId: string, commentId: string) =>
      `/api/documents/${docId}/comments/${commentId}`,
    revisions: (docId: string) => `/api/documents/${docId}/revisions`,
    revisionById: (docId: string, revId: string) =>
      `/api/documents/${docId}/revisions/${revId}`,
    revisionRestore: (docId: string, revId: string) =>
      `/api/documents/${docId}/revisions/${revId}/restore`,
  },
  documentTemplates: {
    list: '/api/document-templates',
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
  drafts: {
    list: '/api/drafts',
    byId: (id: string) => `/api/drafts/${id}`,
  },
  summaries: {
    generate: '/api/summaries/generate',
    generateProject: (projectId: string) =>
      `/api/summaries/generate/project/${projectId}`,
    jobStatus: (jobId: string) => `/api/summaries/generate/status/${jobId}`,
    project: (projectId: string) => `/api/summaries/project/${projectId}`,
  },
  stats: {
    project: (projectId: string) => `/api/stats/project/${projectId}`,
  },
  pullRequests: {
    search: '/api/pull-requests/search',
    link: (taskId: string) => `/api/tasks/${taskId}/pull-requests/link`,
    unlink: (taskId: string, prId: string) =>
      `/api/tasks/${taskId}/pull-requests/${prId}/unlink`,
  },
  sentry: {
    integration: (workspaceUrl: string) =>
      `/api/sentry/integration?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
    mappings: (workspaceUrl: string) =>
      `/api/sentry/mappings?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
    mappingById: (workspaceUrl: string, id: string) =>
      `/api/sentry/mappings/${id}?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
  },
  figma: {
    oauth: (workspaceUrl: string) =>
      `/api/figma/oauth?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
    integration: (workspaceUrl: string) =>
      `/api/figma/integration?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
  },
  googleDrive: {
    oauth: (workspaceUrl: string) =>
      `/api/google-drive/oauth?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
    status: '/api/google-drive/status',
    disconnect: '/api/google-drive',
  },
  sprints: {
    listByTeam: (teamId: string) => `/api/teams/${teamId}/sprints`,
    byId: (sprintId: string) => `/api/sprints/${sprintId}`,
    start: (sprintId: string) => `/api/sprints/${sprintId}/start`,
    close: (sprintId: string) => `/api/sprints/${sprintId}/close`,
    tasks: (sprintId: string) => `/api/sprints/${sprintId}/tasks`,
    taskById: (sprintId: string, taskId: string) =>
      `/api/sprints/${sprintId}/tasks/${taskId}`,
    summary: (sprintId: string) => `/api/sprints/${sprintId}/summary`,
    summaryRetry: (sprintId: string) =>
      `/api/sprints/${sprintId}/summary/retry`,
    burnup: (sprintId: string) => `/api/sprints/${sprintId}/burnup`,
    teamPerformance: (sprintId: string) =>
      `/api/sprints/${sprintId}/team-performance`,
    cadence: (teamId: string) => `/api/teams/${teamId}/cadence`,
  },
  milestones: {
    workspace: '/api/milestones/workspace',
    listByProject: (projectId: string) =>
      `/api/projects/${projectId}/milestones`,
    byId: (milestoneId: string) => `/api/milestones/${milestoneId}`,
    tasks: (milestoneId: string) => `/api/milestones/${milestoneId}/tasks`,
    byProjectAndSlug: (projectId: string, slug: string) =>
      `/api/projects/${projectId}/milestones/by-slug/${encodeURIComponent(slug)}`,
    reorder: (projectId: string) =>
      `/api/projects/${projectId}/milestones/reorder`,
    archive: (milestoneId: string) => `/api/milestones/${milestoneId}/archive`,
    unarchive: (milestoneId: string) =>
      `/api/milestones/${milestoneId}/unarchive`,
  },
  teams: {
    tasks: (teamId: string) => `/api/teams/${teamId}/tasks`,
  },
}

// ─── Local storage / cache keys ───────────────────────────────────────────────

export const CACHE_KEY = {
  preferences: 'lumo:preferences',
  myTasks: 'lumo:myTasks',
  comments: (taskId: string) => `lumo:comments:${taskId}`,
  description: (taskId: string) => `lumo:desc:${taskId}`,
  projects: 'lumo:projects',
  members: 'lumo:members',
  invites: 'lumo:invites',
  projectTasks: (projectId: string) => `lumo:projectTasks:${projectId}`,
  workspace: 'lumo:workspace',
  teams: 'lumo:teams',
  sprints: (teamId: string, status?: string) =>
    `lumo:sprints:${teamId}${status ? `:${status}` : ''}`,
  sprint: (sprintId: string) => `lumo:sprint:${sprintId}`,
  sprintByNumber: (workspaceUrl: string, number: number) =>
    `lumo:sprint:${workspaceUrl}:n:${number}`,
  notifications: 'lumo:notifications',
  agentActors: 'lumo:agentActors',
  displayMyTasks: (userId: string) => `lumo:display:my-tasks:${userId}`,
  displayProject: (projectId: string) => `lumo:display:project:${projectId}`,
  documents: 'lumo:documents',
  documentDetail: (docId: string) => `lumo:doc:${docId}`,
  documentTree: 'lumo:document-tree',
  treeExpanded: 'lumo:tree-expanded',
  sprintSidebarCollapsed: 'lumo:sprint-sidebar-collapsed',
  milestoneSidebarCollapsed: 'lumo:milestone-sidebar-collapsed',
  docViewMode: 'lumo:doc-view-mode',
  docSort: 'lumo:doc-sort',
  drafts: 'lumo:drafts',
  projectSummary: (projectId: string) => `lumo:summary:project:${projectId}`,
  formRecoveryNewTask: 'lumo:form-recovery:new-task',
  formRecoveryNewProject: 'lumo:form-recovery:new-project',
  formRecoveryQuickDispatch: 'lumo:form-recovery:quick-dispatch',
  agentRuns: (taskId: string) => `lumo:agent-runs:${taskId}`,
}

// ─── Drag-and-drop ────────────────────────────────────────────────────────────

export const DND_ACTIVATION_DISTANCE = 8

// ─── Idea / draft badge ───────────────────────────────────────────────────────

export const IDEA_BADGE_CLS =
  'text-caption px-1.5 py-0.5 rounded-sm bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
