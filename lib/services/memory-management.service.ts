import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import type { MemoryCategory, TaskArtifactAgent } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'
import type { Prisma } from '@prisma/client'

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

interface CreateForProjectInput {
  projectId: string
  workspaceId: string
  category: MemoryCategory
  content: MemoryContent
  actorMemberId: string
  agent?: TaskArtifactAgent | undefined
}

interface CreateForTaskInput {
  taskId: string
  projectId: string
  workspaceId: string
  category: MemoryCategory
  content: MemoryContent
  actorMemberId: string
  agent?: TaskArtifactAgent | undefined
}

/**
 * Best-effort embed + store for a single content text. Never throws — a
 * gateway failure is logged and the row stays with embedding=NULL (the
 * backfill script covers it later). Kept as a local helper so the three
 * manual write-paths (create task/project, edit, promote) stay thin.
 */
async function stampEmbeddingBestEffort(
  id: string,
  category: MemoryCategory,
  content: unknown
): Promise<void> {
  const text = memoryContentToText(category, content)
  if (!text) return
  try {
    const vectors = await embedTexts([text])
    const vector = vectors[0]
    if (vector !== undefined) {
      await memoryRepository.setEmbedding(id, vector)
    }
  } catch (err) {
    logger.warn(
      `[memory-management] embedTexts failed for id=${id} — embedding skipped:`,
      err instanceof Error ? err.message : err
    )
  }
}

/**
 * Human-driven CRUD over Memory rows. Deliberately disjoint from
 * lib/services/memory/ (layer1/layer2), which are LLM-driven and must not
 * pull their gateway dependencies into the HTTP request path.
 *
 * Embedding stamping (LUM-324): every manual write that sets or changes
 * `content` also stamps a best-effort pgvector embedding AFTER the content
 * write. The embed call is outside the DB write so a gateway failure never
 * aborts the mutation. Rows that fail to embed stay with embedding=NULL and
 * are covered by the backfill script.
 */
export const memoryManagementService = {
  listProjectMemories(projectId: string) {
    return memoryRepository.listForProject(projectId)
  },

  listTaskMemories(taskId: string) {
    return memoryRepository.listForTask(taskId)
  },

  async createForProject(input: CreateForProjectInput) {
    const created = await memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: null,
      scope: 'PROJECT',
      category: input.category,
      content: input.content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      agent: input.agent,
    })
    // Best-effort embedding — fire-and-forget (await so errors surface in warn)
    await stampEmbeddingBestEffort(created.id, input.category, input.content)
    return created
  },

  async createForTask(input: CreateForTaskInput) {
    const created = await memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      scope: 'TASK',
      category: input.category,
      content: input.content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      agent: input.agent,
    })
    await stampEmbeddingBestEffort(created.id, input.category, input.content)
    return created
  },

  async editContent(memoryId: string, content: MemoryContent) {
    // Look up the category so stampEmbeddingBestEffort can compute the text.
    // findByIdWithWorkspace already selects category.
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    // Uses update() (not updateContent()) so the full row is returned for the
    // HTTP response; updateContent() returns only { id }.
    const updated = await memoryRepository.update(memoryId, {
      content: content as Prisma.InputJsonValue,
    })
    if (existing) {
      await stampEmbeddingBestEffort(memoryId, existing.category, content)
    }
    return updated
  },

  async promoteToProject(memoryId: string, content?: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing) throw httpError('Not found', 404)
    if (existing.scope === 'PROJECT') {
      throw httpError('Memory is already project-scoped', 409)
    }
    const updated = await memoryRepository.update(memoryId, {
      scope: 'PROJECT',
      taskId: null,
      ...(content !== undefined
        ? { content: content as Prisma.InputJsonValue }
        : {}),
    })
    // Stamp embedding if content changed; if only scope changed there is no
    // new text to embed (content unchanged), so skip to avoid a redundant
    // re-embed (the row already has an embedding if it was stamped on create).
    if (content !== undefined) {
      await stampEmbeddingBestEffort(memoryId, existing.category, content)
    }
    return updated
  },

  async delete(memoryId: string) {
    await memoryRepository.delete(memoryId)
  },
}
