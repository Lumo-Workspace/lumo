import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { canonicalizeToEnglish } from './memory/canonicalize-language'
import { resolveManualDedup } from './memory/manual-dedup'
import { screenCandidate } from './memory/extraction-gate'
import { formatScreenRejection } from './memory/screen-rejection'
import {
  loadConstitutionSource,
  type ConstitutionScope,
} from './memory/constitution'
import type { MemoryCategory, TaskArtifactAgent } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'
import type { Prisma } from '@prisma/client'

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

/**
 * Source de-dup gate (LUM-538) for the manual write paths. Rejects an
 * incomplete-fact fragment or an entry the project constitution already
 * documents with a 422 (the CLI surfaces the message) — the same screen the
 * Layer-1 extraction path applies, so manual adds can't smuggle in what
 * extraction now filters. Returns without throwing when the candidate is clean.
 *
 * The constitution is the PROJECT's own CLAUDE.md / AGENTS.md, read from its
 * linked repository (LUM-778) — never the server's cwd — and the rejection
 * names that repo and quotes the matched line so the user can verify it.
 */
async function screenManualCandidate(
  scope: ConstitutionScope,
  category: MemoryCategory,
  content: unknown
): Promise<void> {
  const constitution = await loadConstitutionSource(scope)
  const verdict = screenCandidate({
    category,
    content,
    constitution: constitution.text,
  })
  if (verdict.ok) return
  throw httpError(formatScreenRejection(verdict, constitution.repo), 422)
}

export type CreateOutcome = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP'
export interface CreateMemoryResult {
  outcome: CreateOutcome
  memory: { id: string }
}

/** Embed the (canonical) candidate text once for retrieval; undefined on failure
 * (retrieval then degrades to lexical). Never throws. */
async function embedCandidate(text: string): Promise<number[] | undefined> {
  if (!text) return undefined
  try {
    const [v] = await embedTexts([text])
    return v
  } catch {
    return undefined
  }
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

  // NOTE: createForTask mirrors createForProject (differs only in scope/taskId/
  // pool source). Keep the two in sync when changing the canonicalize/dedup flow.
  async createForProject(
    input: CreateForProjectInput
  ): Promise<CreateMemoryResult> {
    const content = await canonicalizeToEnglish(input.category, input.content)
    await screenManualCandidate(
      { projectId: input.projectId, workspaceId: input.workspaceId },
      input.category,
      content
    )
    const text = memoryContentToText(input.category, content)
    const vector = await embedCandidate(text)
    const pool = (await memoryRepository.listForProject(input.projectId)).map(
      m => ({ id: m.id, category: m.category, content: m.content })
    )
    const resolution = await resolveManualDedup({
      category: input.category,
      content,
      candidateText: text,
      candidateVector: vector,
      pool,
      scope: { kind: 'PROJECT', projectId: input.projectId },
    })

    if (resolution.kind === 'NOOP') {
      return { outcome: 'NOOP', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'UPDATE') {
      await memoryRepository.updateContent(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(
        resolution.id,
        input.category,
        resolution.content
      )
      return { outcome: 'UPDATE', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'SUPERSEDE') {
      const { newId } = await memoryRepository.supersede(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(newId, input.category, resolution.content)
      return { outcome: 'SUPERSEDE', memory: { id: newId } }
    }
    // ADD
    const created = await memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: null,
      scope: 'PROJECT',
      category: input.category,
      content: content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      agent: input.agent,
    })
    // Reuse the vector already computed for dedup retrieval (same text) instead
    // of re-embedding. If that embed failed (vector undefined), fall back to a
    // best-effort stamp (which no-ops again on a repeat gateway failure).
    if (vector !== undefined) {
      await memoryRepository.setEmbedding(created.id, vector)
    } else {
      await stampEmbeddingBestEffort(created.id, input.category, content)
    }
    return { outcome: 'ADD', memory: { id: created.id } }
  },

  async createForTask(input: CreateForTaskInput): Promise<CreateMemoryResult> {
    const content = await canonicalizeToEnglish(input.category, input.content)
    await screenManualCandidate(
      { projectId: input.projectId, workspaceId: input.workspaceId },
      input.category,
      content
    )
    const text = memoryContentToText(input.category, content)
    const vector = await embedCandidate(text)
    const pool = (await memoryRepository.listForTask(input.taskId)).map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    }))
    const resolution = await resolveManualDedup({
      category: input.category,
      content,
      candidateText: text,
      candidateVector: vector,
      pool,
      scope: { kind: 'TASK', taskId: input.taskId },
    })

    if (resolution.kind === 'NOOP') {
      return { outcome: 'NOOP', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'UPDATE') {
      await memoryRepository.updateContent(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(
        resolution.id,
        input.category,
        resolution.content
      )
      return { outcome: 'UPDATE', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'SUPERSEDE') {
      const { newId } = await memoryRepository.supersede(
        resolution.id,
        resolution.content as Prisma.InputJsonValue
      )
      await stampEmbeddingBestEffort(newId, input.category, resolution.content)
      return { outcome: 'SUPERSEDE', memory: { id: newId } }
    }
    const created = await memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      scope: 'TASK',
      category: input.category,
      content: content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
      // Manual task-scoped adds have an unambiguous birth task (LUM-397).
      sourceTaskId: input.taskId,
      agent: input.agent,
    })
    // Reuse the vector already computed for dedup retrieval (same text) instead
    // of re-embedding. If that embed failed (vector undefined), fall back to a
    // best-effort stamp (which no-ops again on a repeat gateway failure).
    if (vector !== undefined) {
      await memoryRepository.setEmbedding(created.id, vector)
    } else {
      await stampEmbeddingBestEffort(created.id, input.category, content)
    }
    return { outcome: 'ADD', memory: { id: created.id } }
  },

  async editContent(memoryId: string, content: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    const canonical = existing
      ? await canonicalizeToEnglish(existing.category, content)
      : content
    const updated = await memoryRepository.update(memoryId, {
      content: canonical as Prisma.InputJsonValue,
    })
    if (existing) {
      await stampEmbeddingBestEffort(memoryId, existing.category, canonical)
    }
    return updated
  },

  async promoteToProject(memoryId: string, content?: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing) throw httpError('Not found', 404)
    if (existing.scope === 'PROJECT') {
      throw httpError('Memory is already project-scoped', 409)
    }
    const canonical =
      content !== undefined
        ? await canonicalizeToEnglish(existing.category, content)
        : undefined
    const updated = await memoryRepository.update(memoryId, {
      scope: 'PROJECT',
      taskId: null,
      ...(canonical !== undefined
        ? { content: canonical as Prisma.InputJsonValue }
        : {}),
    })
    if (canonical !== undefined) {
      await stampEmbeddingBestEffort(memoryId, existing.category, canonical)
    }
    return updated
  },

  async delete(memoryId: string) {
    await memoryRepository.delete(memoryId)
  },
}
