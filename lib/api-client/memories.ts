import { apiFetch } from './base'
import type {
  MemoryScope,
  MemoryCategory,
  TaskArtifactAgent,
} from '@prisma/client'

export type CreateOutcome = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP'

export interface MemoryRow {
  id: string
  scope: MemoryScope
  category: MemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  taskId: string | null
  createdByMemberId: string | null
  createdAt: string
  updatedAt: string
}

interface CreateBody {
  category: MemoryCategory
  content: unknown
}

/**
 * One downsync entry as it arrives over the wire. Structural mirror of the
 * server's ShapedSyncEntry — kept local so the api-client (and the CLI that
 * imports it) never pulls in `@/lib/services`. The server may include extra
 * fields (slug/category/scope/description); the CLI only needs these.
 */
export interface SyncBundleEntry {
  id: string
  relPath: string
  frontmatter: string
  body: string
  contentHash: string
  indexLine: string
}

export interface SyncBundle {
  projectId: string
  entries: SyncBundleEntry[]
}

export const memoriesClient = {
  listForProject(projectId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/projects/${projectId}/memories`)
  },

  listForTask(taskId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/tasks/${taskId}/memories`)
  },

  getSyncBundle(projectId: string): Promise<{ bundle: SyncBundle }> {
    return apiFetch(`/api/projects/${projectId}/memories/sync-bundle`)
  },

  createForProject(
    projectId: string,
    body: CreateBody
  ): Promise<{ memory: { id: string }; outcome: CreateOutcome }> {
    return apiFetch(`/api/projects/${projectId}/memories`, {
      method: 'POST',
      body,
    })
  },

  createForTask(
    taskId: string,
    body: CreateBody
  ): Promise<{ memory: { id: string }; outcome: CreateOutcome }> {
    return apiFetch(`/api/tasks/${taskId}/memories`, { method: 'POST', body })
  },

  editContent(
    memoryId: string,
    content: unknown
  ): Promise<{ memory: MemoryRow }> {
    return apiFetch(`/api/memories/${memoryId}`, {
      method: 'PATCH',
      body: { content },
    })
  },

  promoteToProject(
    memoryId: string,
    content?: unknown
  ): Promise<{ memory: MemoryRow }> {
    return apiFetch(`/api/memories/${memoryId}`, {
      method: 'PATCH',
      body:
        content !== undefined
          ? { scope: 'PROJECT', content }
          : { scope: 'PROJECT' },
    })
  },

  remove(memoryId: string): Promise<void> {
    return apiFetch(`/api/memories/${memoryId}`, { method: 'DELETE' })
  },
}
