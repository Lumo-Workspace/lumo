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
    byProject: (projectId: string) =>
      ['tasks', 'byProject', projectId] as const,
    bySprint: (sprintId: string) => ['tasks', 'bySprint', sprintId] as const,
    backlog: (teamId: string) => ['tasks', 'backlog', teamId] as const,
  },

  comments: (taskId: string) => ['comments', taskId] as const,
  description: (taskId: string) => ['description', taskId] as const,

  projects: {
    all: () => ['projects'] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
  },

  sprints: {
    all: () => ['sprints'] as const,
    byTeam: (teamId: string, status?: SprintStatus) =>
      ['sprints', 'byTeam', teamId, status ?? 'any'] as const,
    detail: (sprintId: string) => ['sprints', 'detail', sprintId] as const,
    byNumber: (workspaceUrl: string, number: number) =>
      ['sprints', 'byNumber', workspaceUrl, number] as const,
    summary: (sprintId: string) => ['sprints', 'summary', sprintId] as const,
  },

  milestones: {
    all: () => ['milestones'] as const,
    byProject: (projectId: string) =>
      ['milestones', 'byProject', projectId] as const,
    detail: (milestoneId: string) =>
      ['milestones', 'detail', milestoneId] as const,
  },

  documents: {
    all: () => ['documents'] as const,
    detail: (docId: string) => ['documents', 'detail', docId] as const,
    tree: () => ['documents', 'tree'] as const,
  },

  summary: {
    project: (projectId: string) => ['summary', 'project', projectId] as const,
    workspace: () => ['summary', 'workspace'] as const,
  },

  tags: () => ['tags'] as const,
}
