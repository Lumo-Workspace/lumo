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

/** Why a memory is proposed for retirement (LUM-540 P4a). Mirrors the wire
 *  shape of the service's RetireReason without importing server code. */
export type RetireReason = 'low-judged-used' | 'contradiction'

export interface RetireCandidate {
  memoryId: string
  reasons: RetireReason[]
}

export const memoriesClient = {
  listForProject(projectId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/projects/${projectId}/memories`)
  },

  listForTask(taskId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/tasks/${taskId}/memories`)
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

  /** Derived list of a project's ACTIVE memories proposed for retirement
   *  (LUM-540 P4a) — low judged-used track record and/or curation-judge
   *  clearly-wrong. Read-only; nothing is persisted. */
  retireCandidates(
    projectId: string
  ): Promise<{ candidates: RetireCandidate[] }> {
    return apiFetch(`/api/projects/${projectId}/memories/retire-candidates`)
  },

  /** Human-confirmed retirement: flips the memory through the existing status
   *  machine (ACTIVE→ARCHIVED, reversible) — never a hard delete. Human-only on
   *  the server (a bearer/CLI caller is refused 403). */
  confirmRetire(memoryId: string): Promise<{ retired: number }> {
    return apiFetch(`/api/memories/${memoryId}/retire`, { method: 'POST' })
  },
}
