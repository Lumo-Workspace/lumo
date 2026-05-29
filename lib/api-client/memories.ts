import { apiFetch } from './base'
import type { MemoryScope, MemoryCategory } from '@prisma/client'

export interface MemoryRow {
  id: string
  scope: MemoryScope
  category: MemoryCategory
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

export const memoriesClient = {
  listForProject(projectId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/projects/${projectId}/memories`)
  },

  listForTask(taskId: string): Promise<{ memories: MemoryRow[] }> {
    return apiFetch(`/api/tasks/${taskId}/memories`)
  },

  createForProject(projectId: string, body: CreateBody): Promise<{ memory: { id: string } }> {
    return apiFetch(`/api/projects/${projectId}/memories`, { method: 'POST', body })
  },

  createForTask(taskId: string, body: CreateBody): Promise<{ memory: { id: string } }> {
    return apiFetch(`/api/tasks/${taskId}/memories`, { method: 'POST', body })
  },

  editContent(memoryId: string, content: unknown): Promise<{ memory: MemoryRow }> {
    return apiFetch(`/api/memories/${memoryId}`, { method: 'PATCH', body: { content } })
  },

  promoteToProject(memoryId: string, content?: unknown): Promise<{ memory: MemoryRow }> {
    return apiFetch(`/api/memories/${memoryId}`, {
      method: 'PATCH',
      body: content !== undefined ? { scope: 'PROJECT', content } : { scope: 'PROJECT' },
    })
  },

  remove(memoryId: string): Promise<void> {
    return apiFetch(`/api/memories/${memoryId}`, { method: 'DELETE' })
  },
}
