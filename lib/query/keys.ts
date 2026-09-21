import type { SprintStatus } from '@prisma/client'

/**
 * Centralized query key factory.
 *
 * Conventions:
 * - First segment is the resource family (`tasks`, `sprints`, …) so
 *   `invalidateQueries({ queryKey: ['tasks'] })` invalidates the whole family.
 * - Detail keys use `'detail'` so list/detail invalidation is independent.
 * - All factories return `as const` tuples so consumers get inferred literal
 *   types when destructuring.
 */
export const queryKeys = {
  workspace: () => ['workspace'] as const,
  teams: () => ['teams'] as const,
  members: () => ['members'] as const,
  invites: () => ['invites'] as const,
  agentActors: () => ['agentActors'] as const,
  notifications: () => ['notifications'] as const,
  drafts: () => ['drafts'] as const,
  preferences: () => ['preferences'] as const,

  tasks: {
    all: () => ['tasks'] as const,
    list: () => ['tasks', 'list'] as const,
    my: () => ['tasks', 'my'] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    forecast: (id: string) => ['tasks', 'forecast', id] as const,
    progress: (id: string) => ['tasks', 'progress', id] as const,
    gates: (id: string) => ['tasks', 'gates', id] as const,
    securityScans: (id: string) => ['tasks', 'securityScans', id] as const,
    byProject: (projectId: string) =>
      ['tasks', 'byProject', projectId] as const,
    byWorkspace: (workspaceId: string, filtersKey: string) =>
      ['tasks', 'byWorkspace', workspaceId, filtersKey] as const,
    bySprint: (sprintId: string) => ['tasks', 'bySprint', sprintId] as const,
    byMilestone: (milestoneId: string) =>
      ['tasks', 'byMilestone', milestoneId] as const,
    backlog: (teamId: string) => ['tasks', 'backlog', teamId] as const,
  },

  comments: (taskId: string) => ['comments', taskId] as const,
  description: (taskId: string) => ['description', taskId] as const,

  prSearch: (workspaceId: string, query: string) =>
    ['pr-search', workspaceId, query] as const,

  projects: {
    all: () => ['projects'] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
  },

  planRuns: {
    list: () => ['planRuns', 'list'] as const,
    latestClustering: () => ['planRuns', 'latestClustering'] as const,
    archive: (runId: string) => ['planRuns', 'archive', runId] as const,
    run: (runId: string) => ['planRuns', 'run', runId] as const,
    alignGate: (runId: string) => ['planRuns', 'alignGate', runId] as const,
    materializeGate: (runId: string) =>
      ['planRuns', 'materializeGate', runId] as const,
  },

  sprints: {
    all: () => ['sprints'] as const,
    byTeam: (teamId: string, status?: SprintStatus) =>
      ['sprints', 'byTeam', teamId, status ?? 'any'] as const,
    detail: (sprintId: string) => ['sprints', 'detail', sprintId] as const,
    byNumber: (workspaceUrl: string, number: number) =>
      ['sprints', 'byNumber', workspaceUrl, number] as const,
    summary: (sprintId: string) => ['sprints', 'summary', sprintId] as const,
    burnup: (sprintId: string) => ['sprints', 'burnup', sprintId] as const,
    teamPerformance: (sprintId: string) =>
      ['sprints', 'teamPerformance', sprintId] as const,
  },

  milestones: {
    all: () => ['milestones'] as const,
    byProject: (projectId: string) =>
      ['milestones', 'byProject', projectId] as const,
    byWorkspace: (workspaceId: string) =>
      ['milestones', 'byWorkspace', workspaceId] as const,
    detail: (milestoneId: string) =>
      ['milestones', 'detail', milestoneId] as const,
    byProjectAndSlug: (projectId: string, slug: string) =>
      ['milestones', 'byProjectAndSlug', projectId, slug] as const,
  },

  documents: {
    all: () => ['documents'] as const,
    detail: (docId: string) => ['documents', 'detail', docId] as const,
    tree: () => ['documents', 'tree'] as const,
  },

  ideas: {
    all: () => ['ideas'] as const,
    comments: (ideaId: string) => ['ideas', ideaId, 'comments'] as const,
    activity: (ideaId: string) => ['ideas', ideaId, 'activity'] as const,
  },

  summary: {
    project: (projectId: string) => ['summary', 'project', projectId] as const,
    workspace: () => ['summary', 'workspace'] as const,
  },

  summaries: {
    generationJob: (jobId: string) =>
      ['summaries', 'generation-job', jobId] as const,
  },

  timeline: (taskId: string) => ['timeline', taskId] as const,

  lineage: (identifier: string) => ['lineage', identifier] as const,

  taskStatus: (identifier: string) => ['taskStatus', identifier] as const,

  boundaryCrossings: (identifier: string) =>
    ['boundaryCrossings', identifier] as const,

  fragmentTrust: (ids: string[]) => ['fragmentTrust', [...ids].sort()] as const,

  retireCandidates: (projectId: string) =>
    ['retireCandidates', projectId] as const,

  mergeCandidates: (projectId: string) =>
    ['mergeCandidates', projectId] as const,

  tags: () => ['tags'] as const,

  taskWebLinks: (taskId: string) => ['task-web-links', taskId] as const,

  taskDependencies: (taskId: string) => ['task-dependencies', taskId] as const,

  documentComments: (docId: string) => ['document-comments', docId] as const,

  documentRevisions: (docId: string) => ['document-revisions', docId] as const,

  taskFigmaLinks: (taskId: string) => ['task-figma-links', taskId] as const,

  taskArtifacts: (taskId: string) => ['task-artifacts', taskId] as const,

  taskTestCases: (taskId: string) => ['task-test-cases', taskId] as const,

  ideaWebLinks: (ideaId: string) => ['idea-web-links', ideaId] as const,

  ideaFigmaLinks: (ideaId: string) => ['idea-figma-links', ideaId] as const,

  ideaPullRequests: (ideaId: string) => ['idea-pull-requests', ideaId] as const,

  integrations: {
    slack: (workspaceUrl: string) =>
      ['integrations', 'slack', workspaceUrl] as const,
    github: (workspaceUrl: string) =>
      ['integrations', 'github', workspaceUrl] as const,
    githubApp: (workspaceUrl: string) =>
      ['integrations', 'github-app', workspaceUrl] as const,
    githubRepos: (workspaceUrl: string) =>
      ['integrations', 'github-repos', workspaceUrl] as const,
    sentry: (workspaceUrl: string) =>
      ['integrations', 'sentry', workspaceUrl] as const,
    sentryMappings: (workspaceUrl: string) =>
      ['integrations', 'sentry-mappings', workspaceUrl] as const,
    figma: (workspaceUrl: string) =>
      ['integrations', 'figma', workspaceUrl] as const,
    googleDrive: (workspaceUrl: string) =>
      ['integrations', 'google-drive', workspaceUrl] as const,
  },
}
