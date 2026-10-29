import { logger } from '@/lib/logger'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import type { ContentSignals } from '@/lib/services/content-signals'
import { embedTexts } from '@/lib/ai/embedding'
import { memoryContentToText } from '@/lib/memory/content-text'
import { canonicalizeToEnglish } from './memory/canonicalize-language'
import { resolveManualDedup } from './memory/manual-dedup'
import { aiFeaturesService } from './ai-features.service'
import { screenCandidate } from './memory/extraction-gate'
import { formatScreenRejection } from './memory/screen-rejection'
import {
  loadConstitutionSource,
  type ConstitutionScope,
} from './memory/constitution'
import { loadMemoryWriteGate, type MemoryWriteGate } from './memory/write-gate'
import {
  recordUsedTrapMemoryDeletion,
  type UsedTrapDeletionInput,
} from './memory/used-trap-delete'
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

/**
 * LUM-793 poison gate for every manual write path (web form, CLI
 * `memory project add` / `memory push`, `PATCH /api/memories/[id]` — all four
 * funnel through this service). Runs BEFORE any repository call, so a
 * rejected memory never reaches the database: this is the whole point of
 * moving the check from injection time to write time.
 *
 * Returns the `contentSignals` summary for the accepted content, so the caller
 * does not scan the same text twice.
 */
function screenWith(
  gate: MemoryWriteGate,
  category: MemoryCategory,
  content: unknown
): ContentSignals | null {
  const verdict = gate.screen(category, content)
  if (!verdict.ok) throw httpError(verdict.message, 422)
  return verdict.signals
}

export type CreateOutcome = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP'
export interface CreateMemoryResult {
  outcome: CreateOutcome
  memory: { id: string }
}

/**
 * LUM-1338: whether the manual write paths may call a model (translate to
 * English, embed, dedup). Off = the text is stored as written, as its own row.
 */
function memoryAssistOn(workspaceId: string): Promise<boolean> {
  return aiFeaturesService.isEnabled({ workspaceId }, 'memoryAssist')
}

/** Embed the (canonical) candidate text once for retrieval; undefined on failure
 * (retrieval then degrades to lexical). Never throws. */
async function embedCandidate(
  text: string,
  assist: boolean
): Promise<number[] | undefined> {
  if (!text || !assist) return undefined
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
  content: unknown,
  assist: boolean
): Promise<void> {
  if (!assist) return
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
    const assist = await memoryAssistOn(input.workspaceId)
    const content = assist
      ? await canonicalizeToEnglish(input.category, input.content)
      : input.content
    await screenManualCandidate(
      { projectId: input.projectId, workspaceId: input.workspaceId },
      input.category,
      content
    )
    const gate = await loadMemoryWriteGate(input.projectId)
    const signals = screenWith(gate, input.category, content)
    const text = memoryContentToText(input.category, content)
    const vector = await embedCandidate(text, assist)
    const pool = (await memoryRepository.listForProject(input.projectId)).map(
      m => ({ id: m.id, category: m.category, content: m.content })
    )
    const resolution = !assist
      ? ({ kind: 'ADD' } as const)
      : await resolveManualDedup({
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
        resolution.content as Prisma.InputJsonValue,
        undefined,
        // The dedup merge produced NEW text — screen what actually lands, not
        // just the candidate that walked in (LUM-793).
        screenWith(gate, input.category, resolution.content)
      )
      await stampEmbeddingBestEffort(
        resolution.id,
        input.category,
        resolution.content,
        assist
      )
      return { outcome: 'UPDATE', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'SUPERSEDE') {
      const { newId } = await memoryRepository.supersede(
        resolution.id,
        resolution.content as Prisma.InputJsonValue,
        undefined,
        // The dedup merge produced NEW text — screen what actually lands, not
        // just the candidate that walked in (LUM-793).
        screenWith(gate, input.category, resolution.content)
      )
      await stampEmbeddingBestEffort(
        newId,
        input.category,
        resolution.content,
        assist
      )
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
      // Already computed by the poison gate on this exact text (LUM-793).
      contentSignals: signals,
    })
    // Reuse the vector already computed for dedup retrieval (same text) instead
    // of re-embedding. If that embed failed (vector undefined), fall back to a
    // best-effort stamp (which no-ops again on a repeat gateway failure).
    if (vector !== undefined) {
      await memoryRepository.setEmbedding(created.id, vector)
    } else {
      await stampEmbeddingBestEffort(
        created.id,
        input.category,
        content,
        assist
      )
    }
    return { outcome: 'ADD', memory: { id: created.id } }
  },

  /**
   * LUM-1131: a PR-review learning, written as a PROJECT CONVENTION so it is
   * read, edited and deleted where every other project memory is. Skips the
   * manual paths' canonicalize / dedup: a learning must stay its own row (its
   * repository scope points at it), and folding it into another memory would
   * put unrelated text into later reviews. The poison gate still runs —
   * a rejected learning throws 422 before anything is written.
   *
   * `link` writes the caller's row that points at the new memory (the
   * learning's repository scope) in the SAME transaction: either both rows
   * land or neither does — never an orphan memory.
   */
  async createReviewLearning(
    input: {
      /**
       * LUM-1157: null when the reviewed repository is linked to no Lumo
       * project — the learning is then scoped to the workspace and the
       * repository by the caller's `link` row (every reviewed repository
       * gets learnings, not only project-linked ones).
       */
      projectId: string | null
      workspaceId: string
      content: { summary: string; rule: string; scope: string }
      actorMemberId: string | null
    },
    link: (memoryId: string, tx: Prisma.TransactionClient) => Promise<void>
  ): Promise<{ id: string }> {
    const gate = await loadMemoryWriteGate(input.projectId)
    const signals = screenWith(gate, 'CONVENTION', input.content)
    let id = ''
    await memoryRepository.applyPlansAtomically([
      async tx => {
        const created = await memoryRepository.create(
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            taskId: null,
            scope: 'PROJECT',
            category: 'CONVENTION',
            content: input.content as Prisma.InputJsonValue,
            sourceSessionId: null,
            createdByMemberId: input.actorMemberId,
            contentSignals: signals,
          },
          tx
        )
        await link(created.id, tx)
        id = created.id
      },
    ])
    await stampEmbeddingBestEffort(
      id,
      'CONVENTION',
      input.content,
      await memoryAssistOn(input.workspaceId)
    )
    return { id }
  },

  async createForTask(input: CreateForTaskInput): Promise<CreateMemoryResult> {
    const assist = await memoryAssistOn(input.workspaceId)
    const content = assist
      ? await canonicalizeToEnglish(input.category, input.content)
      : input.content
    await screenManualCandidate(
      { projectId: input.projectId, workspaceId: input.workspaceId },
      input.category,
      content
    )
    const gate = await loadMemoryWriteGate(input.projectId)
    const signals = screenWith(gate, input.category, content)
    const text = memoryContentToText(input.category, content)
    const vector = await embedCandidate(text, assist)
    const pool = (await memoryRepository.listForTask(input.taskId)).map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    }))
    const resolution = !assist
      ? ({ kind: 'ADD' } as const)
      : await resolveManualDedup({
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
        resolution.content as Prisma.InputJsonValue,
        undefined,
        // The dedup merge produced NEW text — screen what actually lands, not
        // just the candidate that walked in (LUM-793).
        screenWith(gate, input.category, resolution.content)
      )
      await stampEmbeddingBestEffort(
        resolution.id,
        input.category,
        resolution.content,
        assist
      )
      return { outcome: 'UPDATE', memory: { id: resolution.id } }
    }
    if (resolution.kind === 'SUPERSEDE') {
      const { newId } = await memoryRepository.supersede(
        resolution.id,
        resolution.content as Prisma.InputJsonValue,
        undefined,
        // The dedup merge produced NEW text — screen what actually lands, not
        // just the candidate that walked in (LUM-793).
        screenWith(gate, input.category, resolution.content)
      )
      await stampEmbeddingBestEffort(
        newId,
        input.category,
        resolution.content,
        assist
      )
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
      // Already computed by the poison gate on this exact text (LUM-793).
      contentSignals: signals,
    })
    // Reuse the vector already computed for dedup retrieval (same text) instead
    // of re-embedding. If that embed failed (vector undefined), fall back to a
    // best-effort stamp (which no-ops again on a repeat gateway failure).
    if (vector !== undefined) {
      await memoryRepository.setEmbedding(created.id, vector)
    } else {
      await stampEmbeddingBestEffort(
        created.id,
        input.category,
        content,
        assist
      )
    }
    return { outcome: 'ADD', memory: { id: created.id } }
  },

  async editContent(memoryId: string, content: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    const assist = existing ? await memoryAssistOn(existing.workspaceId) : false
    const canonical =
      existing && assist
        ? await canonicalizeToEnglish(existing.category, content)
        : content
    // LUM-793: an edit is a write. A memory that could not be created with
    // this text must not be reachable by editing an innocent row into it.
    const signals = existing
      ? screenWith(
          await loadMemoryWriteGate(existing.projectId),
          existing.category,
          canonical
        )
      : undefined
    const updated = await memoryRepository.update(memoryId, {
      content: canonical as Prisma.InputJsonValue,
      // LUM-783 marks the row; before LUM-793 an edit left the old scan in
      // place, so a row could carry signals its current text no longer has.
      ...(signals !== undefined ? { contentSignals: signals } : {}),
    })
    if (existing) {
      await stampEmbeddingBestEffort(
        memoryId,
        existing.category,
        canonical,
        assist
      )
    }
    return updated
  },

  async promoteToProject(memoryId: string, content?: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing) throw httpError('Not found', 404)
    if (existing.scope === 'PROJECT') {
      throw httpError('Memory is already project-scoped', 409)
    }
    const assist = await memoryAssistOn(existing.workspaceId)
    const canonical =
      content !== undefined
        ? assist
          ? await canonicalizeToEnglish(existing.category, content)
          : content
        : undefined
    // LUM-793: a promote that also rewrites content is an edit — same gate.
    const signals =
      canonical !== undefined
        ? screenWith(
            await loadMemoryWriteGate(existing.projectId),
            existing.category,
            canonical
          )
        : undefined
    const updated = await memoryRepository.update(memoryId, {
      scope: 'PROJECT',
      taskId: null,
      ...(canonical !== undefined
        ? {
            content: canonical as Prisma.InputJsonValue,
            contentSignals: signals ?? null,
          }
        : {}),
    })
    if (canonical !== undefined) {
      await stampEmbeddingBestEffort(
        memoryId,
        existing.category,
        canonical,
        assist
      )
    }
    return updated
  },

  /**
   * Hard-delete a memory. `actor` is the request's identity + Claude Code
   * session; when it is present the LUM-793 detector runs FIRST, so an agent
   * removing a TRAP other tasks were judged to have used leaves a boundary
   * crossing behind instead of a silent gap. Omitting `actor` (internal
   * callers with no request context) skips detection, never the delete.
   */
  async delete(
    memoryId: string,
    actor?: Omit<UsedTrapDeletionInput, 'memory'>
  ) {
    if (actor) {
      const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
      if (existing) {
        await recordUsedTrapMemoryDeletion({ memory: existing, ...actor })
      }
    }
    await memoryRepository.delete(memoryId)
  },
}
