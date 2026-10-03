import { prisma } from '@/lib/db/prisma'
import type { ContentSignals } from '@/shared/src/untrusted-content'
import { contentSignalsData } from './content-signals-column'
import { Prisma } from '@prisma/client'
import type {
  MemoryCategory,
  MemoryScope,
  TaskArtifactAgent,
} from '@prisma/client'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'
import { stripCodeFromStoredFields } from '@/lib/ai-derived/strip-code'

/**
 * Every memory content write: code stripped (LUM-917 — a memory is
 * AI-derived content and stores prose, not pasted code), then credentials
 * redacted (LUM-898).
 */
function storedMemoryFields<T extends object>(
  data: T,
  fields: readonly string[]
): T {
  return redactStoredFields(stripCodeFromStoredFields(data, fields), fields)
}

const MEMORY_ROW_SELECT = {
  id: true,
  scope: true,
  category: true,
  agent: true,
  content: true,
  taskId: true,
  createdByMemberId: true,
  createdAt: true,
  updatedAt: true,
  // LUM-783: the panel card renders a warning badge off this column.
  contentSignals: true,
} as const

interface CreateMemoryInput {
  workspaceId: string
  projectId: string
  taskId: string | null
  scope: MemoryScope
  category: MemoryCategory
  content: Prisma.InputJsonValue
  sourceSessionId: string | null
  createdByMemberId: string | null
  agent?: TaskArtifactAgent | undefined
  /** LUM-783: scan of the content text; null = clean, omit = not scanned. */
  contentSignals?: ContentSignals | null
  /**
   * Scope pointer for MILESTONE-scope rows (LUM-647) — the milestone whose
   * close-retro distilled this lesson. Null/omitted for TASK/PROJECT rows.
   */
  milestoneId?: string | null
  /**
   * Birth task (LUM-397): the task whose session extracted/recorded this
   * memory, distinct from `taskId` (a scope pointer that PROJECT rows null
   * out). Captured at creation, never mutated. Omit when there is no single
   * originating task (Layer-2 consolidation, manual PROJECT adds).
   */
  sourceTaskId?: string | null
}

export const memoryRepository = {
  /**
   * All task-scoped memories for a given task. Used by Layer 1 extraction to
   * feed the LLM the running context so it can issue UPDATE / DELETE ops
   * against existing rows instead of always appending.
   */
  async findActiveTaskMemories(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        content: true,
        createdAt: true,
        // LUM-347: null ⇒ agent-distilled, non-null ⇒ human-recorded — the
        // source-attribution signal for injected memory.
        createdByMemberId: true,
      },
    })
  },

  /**
   * All project-scoped memories for a project. Used by Layer 2 consolidation
   * to feed the LLM existing project facts so it can decide ADD vs UPDATE vs
   * NOOP without duplicating an already-promoted lesson.
   */
  async findActiveProjectMemories(projectId: string) {
    return prisma.memory.findMany({
      where: { projectId, scope: 'PROJECT', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        content: true,
        createdAt: true,
        // LUM-347: see findActiveTaskMemories.
        createdByMemberId: true,
      },
    })
  },

  /**
   * All ACTIVE MILESTONE-scope memories for one milestone (LUM-647). Feeds the
   * close-retro distillation's dedup input (existing lessons already distilled
   * from this milestone) so a retry emits NOOP/UPDATE instead of duplicating.
   */
  async findActiveMilestoneMemories(milestoneId: string) {
    return prisma.memory.findMany({
      where: { milestoneId, scope: 'MILESTONE', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        content: true,
        createdAt: true,
        createdByMemberId: true,
      },
    })
  },

  /**
   * ACTIVE MILESTONE-scope memories across a project (LUM-647), optionally
   * excluding one milestone's own rows. Used to inject a project's prior
   * milestone learnings into the next milestone's steward session — the steward
   * of milestone B reads what milestone A's close distilled, but not B's own.
   */
  async findActiveMilestoneScopeMemoriesByProject(
    projectId: string,
    excludeMilestoneId?: string | null
  ) {
    return prisma.memory.findMany({
      where: {
        projectId,
        scope: 'MILESTONE',
        status: 'ACTIVE',
        ...(excludeMilestoneId
          ? { NOT: { milestoneId: excludeMilestoneId } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        category: true,
        content: true,
        createdAt: true,
        createdByMemberId: true,
        // LUM-648: the milestone this row was distilled from — the source node
        // of a cross-milestone learning-migration edge.
        milestoneId: true,
      },
    })
  },

  /**
   * Projects whose ACTIVE PROJECT-scope memory count exceeds `threshold` —
   * the trigger set for the LUM-328 cold-eviction sweep.
   */
  async findProjectsOverActiveMemoryThreshold(threshold: number) {
    const rows = await prisma.memory.groupBy({
      by: ['projectId'],
      where: { scope: 'PROJECT', status: 'ACTIVE' },
      _count: { _all: true },
      having: { projectId: { _count: { gt: threshold } } },
    })
    return rows.map(r => ({
      projectId: r.projectId,
      activeCount: r._count._all,
    }))
  },

  /**
   * ACTIVE PROJECT rows with just the fields the LUM-328 compaction ranking
   * needs: freshness (createdAt) and the manual-curation exemption
   * (createdByMemberId).
   */
  async findActiveProjectMemoriesForCompaction(projectId: string) {
    return prisma.memory.findMany({
      where: { projectId, scope: 'PROJECT', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, createdByMemberId: true },
    })
  },

  /**
   * Cold eviction (LUM-328): flip rows to ARCHIVED. Guarded to ACTIVE so a
   * stale candidate list can never clobber a SUPERSEDED audit row, and the
   * archive is reversible by flipping status back — no other state is touched.
   */
  async archiveMemories(ids: string[]) {
    if (ids.length === 0) return { count: 0 }
    return prisma.memory.updateMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    })
  },

  /**
   * LUM-541 (P5) — workspace-scoped archive for the human-confirmed batch
   * near-dup merge. Same reversible ACTIVE→ARCHIVED flip as `archiveMemories`,
   * but additionally bounded to one workspace so a confirm body can never
   * archive a row outside the caller's workspace (the merge route's defence in
   * depth on top of the clerk gate). Never a hard delete.
   */
  async archiveMemoriesInWorkspace(ids: string[], workspaceId: string) {
    if (ids.length === 0) return { count: 0 }
    return prisma.memory.updateMany({
      where: { id: { in: ids }, workspaceId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    })
  },

  /**
   * Most recent TASK-scope memories for a project, newest first, capped at
   * `limit`. Layer 2 consolidation reads these to look for recurring lessons
   * across tasks. The `taskId` is included so the prompt can group rows by
   * source task (the "this lesson surfaced in N different tasks" signal).
   *
   * `limit` exists to bound prompt size; v1 picks a small cap (e.g. 200) and
   * accepts that very old rows will not be re-considered. If a workspace
   * outgrows this, switch to a cursor-based scan.
   */
  async findRecentTaskScopeMemoriesByProject(projectId: string, limit: number) {
    return prisma.memory.findMany({
      where: {
        projectId,
        scope: 'TASK',
        taskId: { not: null },
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        category: true,
        content: true,
        taskId: true,
        createdAt: true,
      },
    })
  },

  /**
   * LUM-764 — the project's ACTIVE TRAP memories, newest first and bounded.
   * The L3 hunt planner reads them as "what has this team already walked
   * into"; it is a FAST-bucket routing call with a per-section item cap, so
   * pulling every project memory and filtering in memory would be an
   * unbounded read to throw most of away. Scope is not narrowed to PROJECT:
   * a trap distilled on a task is the same warning, and the planner has no
   * use for the distinction.
   */
  async findActiveTrapMemoriesByProject(projectId: string, limit: number) {
    return prisma.memory.findMany({
      where: { projectId, category: 'TRAP', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, content: true, createdAt: true },
    })
  },

  /**
   * All task-scoped memories grouped by sourceSessionId. Used by the Agent
   * Run timeline so each Run card can show the memories that were sedimented
   * during that Claude Code session.
   */
  async findByTaskIdWithSession(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        agent: true,
        content: true,
        sourceSessionId: true,
        createdAt: true,
      },
    })
  },

  /**
   * Memories sedimented by a specific Claude Code session (Layer 1 sets
   * sourceSessionId; Layer 2 leaves it null so it's naturally excluded).
   * `since` (the review watermark) filters to rows created strictly after it.
   * Oldest-first so the wrap list reads in the order they were learned.
   */
  async findBySourceSessionId(
    sessionId: string,
    opts: { since?: Date; sourceTaskId?: string } = {}
  ) {
    const { since, sourceTaskId } = opts
    return prisma.memory.findMany({
      where: {
        sourceSessionId: sessionId,
        status: 'ACTIVE',
        ...(since ? { createdAt: { gt: since } } : {}),
        // LUM-932 P3: scope to one birth task (an unattached session spans
        // several tasks; curation for one must not touch another's memories).
        ...(sourceTaskId ? { sourceTaskId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: MEMORY_ROW_SELECT,
    })
  },

  /**
   * Content for a set of memory ids, keyed by id (LUM-300 usage-vote labels).
   * Missing ids are simply absent from the map. Empty input → empty map.
   */
  async findContentByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const rows = await prisma.memory.findMany({
      where: { id: { in: ids } },
      select: { id: true, content: true },
    })
    // content is structured JSON (per category); stringify so callers get a
    // human-recognizable label. Plain-string content (rare) passes through.
    return new Map(
      rows.map(r => [
        r.id,
        typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
      ])
    )
  },

  /**
   * PROJECT-scope memories a specific session consolidated into a project
   * (Layer 2 stamps `sourceSessionId` on its ADDs since LUM-165). Scoped to
   * the project so a previous session that touched a different project's
   * memories doesn't leak in. Oldest-first to read in the order they were
   * promoted. Used by the session-start Layer 2 review.
   */
  async findProjectMemoriesBySession(sessionId: string, projectId: string) {
    return prisma.memory.findMany({
      where: {
        sourceSessionId: sessionId,
        projectId,
        scope: 'PROJECT',
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
      select: MEMORY_ROW_SELECT,
    })
  },

  /** All PROJECT-scope memories for a project, newest first. Management UI. */
  async listForProject(projectId: string) {
    return prisma.memory.findMany({
      where: { projectId, scope: 'PROJECT', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: MEMORY_ROW_SELECT,
    })
  },

  /**
   * Upsert the current code-anchor staleness report for a memory (LUM-547 P4b).
   * One report per memory (unique memoryId) — re-reporting overwrites the
   * evidence rather than stacking rows (idempotent). Writes only this satellite
   * table; NEVER touches Memory.status — retirement stays human-confirmed.
   */
  async upsertStaleAnchorReport(input: {
    memoryId: string
    projectId: string
    workspaceId: string
    deadAnchors: Prisma.InputJsonValue
    reportedBySession?: string | null
  }) {
    return prisma.memoryStaleAnchorReport.upsert({
      where: { memoryId: input.memoryId },
      create: {
        memoryId: input.memoryId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        deadAnchors: input.deadAnchors,
        reportedBySession: input.reportedBySession ?? null,
      },
      update: {
        deadAnchors: input.deadAnchors,
        reportedBySession: input.reportedBySession ?? null,
      },
    })
  },

  /**
   * The current stale-anchor reports for a project (LUM-547), folded into the
   * P4a retire pool by `computeProjectRetireCandidates`. Reports for non-ACTIVE
   * memories simply never match the pool's ACTIVE list, so orphans are inert.
   */
  async listStaleAnchorReportsForProject(projectId: string) {
    return prisma.memoryStaleAnchorReport.findMany({
      where: { projectId },
      select: { memoryId: true, deadAnchors: true },
    })
  },

  /** All memories for a task, newest first. Management UI. */
  async listForTask(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: MEMORY_ROW_SELECT,
    })
  },

  /**
   * Whether the task has any memory (LUM-321 Memory-tab presence). Same `taskId`
   * filter as `listForTask`, kept adjacent so the cheap SSR existence check and
   * the panel's list can't drift apart.
   */
  async hasForTask(taskId: string): Promise<boolean> {
    const row = await prisma.memory.findFirst({
      where: { taskId, status: 'ACTIVE' },
      select: { id: true },
    })
    return row !== null
  },

  /**
   * Patch content and/or scope and/or taskId in one write. Undefined fields
   * are omitted so a content-only edit never touches scope. Returns the full
   * row for the HTTP response.
   */
  async update(
    id: string,
    patch: {
      content?: Prisma.InputJsonValue
      scope?: MemoryScope
      taskId?: string | null
      /** LUM-793: scan of the NEW content; omit = leave the column as is. */
      contentSignals?: ContentSignals | null
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    const data: Prisma.MemoryUpdateInput = {}
    if (patch.content !== undefined)
      data.content = storedMemoryFields(
        { content: patch.content },
        STORAGE_REDACTED_FIELDS.memory
      ).content
    if (patch.contentSignals !== undefined) {
      Object.assign(data, contentSignalsData(patch.contentSignals))
    }
    if (patch.scope !== undefined) data.scope = patch.scope
    if (patch.taskId !== undefined) {
      data.task =
        patch.taskId === null
          ? { disconnect: true }
          : { connect: { id: patch.taskId } }
    }
    return client.memory.update({
      where: { id },
      data,
      select: MEMORY_ROW_SELECT,
    })
  },

  /**
   * Auth-relevant fields plus the full card. PATCH/DELETE routes use the
   * `workspaceId`/`scope`/`category` fields for authorization; `GET
   * /api/memories/[id]` (LUM-500) additionally renders `content`/`agent`/
   * `createdByMemberId`/timestamps. `workspaceId` is a top-level column on the
   * Memory row, so workspace ownership reads straight off `memory.workspaceId`.
   */
  async findByIdWithWorkspace(id: string) {
    return prisma.memory.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        taskId: true,
        scope: true,
        category: true,
        agent: true,
        content: true,
        createdByMemberId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  },

  async create(input: CreateMemoryInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.memory.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: input.taskId,
        milestoneId: input.milestoneId ?? null,
        scope: input.scope,
        category: input.category,
        content: storedMemoryFields(
          { content: input.content },
          STORAGE_REDACTED_FIELDS.memory
        ).content,
        sourceSessionId: input.sourceSessionId,
        createdByMemberId: input.createdByMemberId,
        sourceTaskId: input.sourceTaskId ?? null,
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
        ...contentSignalsData(input.contentSignals),
      },
      select: { id: true },
    })
  },

  async updateContent(
    id: string,
    content: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
    /** LUM-783: scan of the NEW content; omit = leave the column as is. */
    contentSignals?: ContentSignals | null
  ) {
    const client = tx ?? prisma
    return client.memory.update({
      where: { id },
      data: {
        ...storedMemoryFields({ content }, STORAGE_REDACTED_FIELDS.memory),
        ...contentSignalsData(contentSignals),
      },
      select: { id: true },
    })
  },

  /**
   * SUPERSEDE seam (LUM-325, Option B — invalidate-not-delete). A new memory
   * contradicts/replaces an existing one. Instead of overwriting the old row's
   * content in place (LUM-324 interim, which destroyed history), this:
   *   1. reads the old row's scope/ownership fields,
   *   2. INSERTs a fresh ACTIVE row carrying the new content (status + validFrom
   *      come from column defaults; sourceSessionId/agent/creator copied from the
   *      old row so the replacement doesn't pollute the current session's wrap
   *      review),
   *   3. flips the old row to SUPERSEDED — content PRESERVED for audit + lineage
   *      — stamping supersededAt + supersededById,
   *   4. writes a MemoryProvenance(parent=old, child=new) edge so the existing
   *      `resolveCanonicalFragment` rolls lineage edges keyed by the old id up to
   *      the new active row (the same mechanism as Layer-2 promotion — keeps the
   *      flywheel merge-rate signal joined across the supersede).
   * Returns the NEW row id: the new content's embedding belongs on the new
   * active row, so the caller must `setEmbedding(newId, …)` (the old row's stale
   * embedding is harmless — the active filter excludes it from retrieval).
   */
  async supersede(
    oldId: string,
    content: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
    /** LUM-783: scan of the NEW content, stored on the replacement row. */
    contentSignals?: ContentSignals | null
  ): Promise<{ newId: string }> {
    const client = tx ?? prisma
    const old = await client.memory.findUniqueOrThrow({
      where: { id: oldId },
      select: {
        workspaceId: true,
        projectId: true,
        taskId: true,
        scope: true,
        category: true,
        agent: true,
        sourceSessionId: true,
        createdByMemberId: true,
        sourceTaskId: true,
      },
    })
    const created = await client.memory.create({
      data: {
        workspaceId: old.workspaceId,
        projectId: old.projectId,
        taskId: old.taskId,
        scope: old.scope,
        category: old.category,
        agent: old.agent,
        content: storedMemoryFields(
          { content: content },
          STORAGE_REDACTED_FIELDS.memory
        ).content,
        sourceSessionId: old.sourceSessionId,
        createdByMemberId: old.createdByMemberId,
        // Birth record travels with the lineage chain (LUM-397): the
        // replacement row keeps the original's birth task.
        sourceTaskId: old.sourceTaskId,
        ...contentSignalsData(contentSignals),
      },
      select: { id: true },
    })
    await client.memory.update({
      where: { id: oldId },
      data: {
        status: 'SUPERSEDED',
        supersededAt: new Date(),
        supersededById: created.id,
      },
      select: { id: true },
    })
    await client.memoryProvenance.create({
      data: { parentMemoryId: oldId, childMemoryId: created.id },
    })
    return { newId: created.id }
  },

  /**
   * LUM-553 — topic folding. Many→one supersede in ONE transaction:
   *   1. re-read which requested sources are STILL ACTIVE in this project
   *      (guard: a concurrent run may have already superseded some); abort if
   *      fewer than 2 remain (nothing meaningful to fold, no orphan coarse card),
   *   2. create the coarse card (ACTIVE, PROJECT, agent-distilled),
   *   3. flip the still-ACTIVE sources → SUPERSEDED, supersededById = coarse,
   *   4. write a MemoryProvenance(parent=source, child=coarse) edge per source
   *      (so resolveCanonicalFragment rolls lineage up to the coarse card).
   * Never a hard delete (失效非删). Returns the new coarse card id; the caller
   * embeds it.
   */
  async foldInto(params: {
    sourceIds: string[]
    coarseContent: Prisma.InputJsonValue
    category: MemoryCategory
    projectId: string
    workspaceId: string
    sourceSessionId?: string | null
    /** LUM-783: scan of the coarse card's content. */
    contentSignals?: ContentSignals | null
  }): Promise<{ coarseId: string }> {
    return prisma.$transaction(async tx => {
      const stillActive = await tx.memory.findMany({
        where: {
          id: { in: params.sourceIds },
          status: 'ACTIVE',
          scope: 'PROJECT',
          projectId: params.projectId,
        },
        select: { id: true },
      })
      if (stillActive.length < 2) {
        throw Object.assign(
          new Error('fold aborted: fewer than 2 sources still ACTIVE'),
          { status: 409 }
        )
      }
      const activeIds = stillActive.map(s => s.id)

      const coarse = await tx.memory.create({
        data: {
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          scope: 'PROJECT',
          category: params.category,
          content: storedMemoryFields(
            { content: params.coarseContent },
            STORAGE_REDACTED_FIELDS.memory
          ).content,
          agent: 'CLAUDE_CODE',
          createdByMemberId: null,
          sourceSessionId: params.sourceSessionId ?? null,
          sourceTaskId: null,
          ...contentSignalsData(params.contentSignals),
        },
        select: { id: true },
      })

      await tx.memory.updateMany({
        where: { id: { in: activeIds }, status: 'ACTIVE' },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date(),
          supersededById: coarse.id,
        },
      })

      await tx.memoryProvenance.createMany({
        data: activeIds.map(id => ({
          parentMemoryId: id,
          childMemoryId: coarse.id,
        })),
        skipDuplicates: true,
      })

      return { coarseId: coarse.id }
    })
  },

  /**
   * LUM-553 — every project that currently has at least one ACTIVE PROJECT-scope
   * memory, for the daily fold cron to iterate. Distinct projectId, non-null.
   */
  async findProjectIdsWithActiveProjectMemory(): Promise<string[]> {
    const rows = await prisma.memory.findMany({
      where: { scope: 'PROJECT', status: 'ACTIVE' },
      distinct: ['projectId'],
      select: { projectId: true },
    })
    return rows.map(r => r.projectId).filter((id): id is string => id !== null)
  },

  // ---------------------------------------------------------------------------
  // pgvector raw-SQL — deliberate exception to the "no raw SQL" rule.
  // The `embedding vector(1024)` column is `Unsupported` in Prisma, so the
  // typed client cannot read or write it. All raw SQL here is confined to this
  // repository, and every user-controlled value is bound as a parameter via
  // Prisma.sql tagged templates — never string-interpolated.
  // ---------------------------------------------------------------------------

  /**
   * Write (or overwrite) the embedding vector for a memory row.
   * Vectors + ids are bound as parameters; never interpolated.
   */
  async setEmbedding(
    id: string,
    vector: number[],
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const client = tx ?? prisma
    // Serialize to pgvector text literal, e.g. "[0.1,0.2,0.3]"
    const lit = `[${vector.join(',')}]`
    // Both `lit` (the vector literal) and `id` are bound as SQL parameters.
    await client.$executeRaw(
      Prisma.sql`UPDATE "memories" SET "embedding" = ${lit}::vector WHERE "id" = ${id}`
    )
  },

  /**
   * Return the k nearest-neighbor memories to `queryVector` within `scope`,
   * ordered by cosine distance ASC (smallest distance = most similar first).
   *
   * Scope mirrors the lexical-pool filters used by `findActiveTaskMemories` /
   * `findActiveProjectMemories` (no category filter — cross-category corpus
   * matches the same pool; category preference is handled at reconcile/apply).
   *
   * Also runs a cheap EXISTS probe to indicate whether the scope already has
   * ANY embeddings, so callers can decide whether to fall back to lexical
   * matching when the corpus is cold.
   */
  async findNeighborEmbeddings({
    scope,
    queryVector,
    k,
  }: {
    scope:
      | { kind: 'TASK'; taskId: string }
      | { kind: 'PROJECT'; projectId: string }
    queryVector: number[]
    k: number
  }): Promise<{
    neighbors: Array<{
      id: string
      category: MemoryCategory
      content: unknown
      score: number
    }>
    scopeHasEmbeddings: boolean
  }> {
    // Build scope WHERE fragment safely via Prisma.sql composition.
    const scopeWhere =
      scope.kind === 'TASK'
        ? Prisma.sql`"taskId" = ${scope.taskId}`
        : Prisma.sql`"projectId" = ${scope.projectId} AND "scope" = 'PROJECT'`

    const qvLit = `[${queryVector.join(',')}]`

    // Main ANN query — no category filter (review point E).
    type NeighborRow = {
      id: string
      category: MemoryCategory
      content: unknown
      distance: number
    }
    const rows = await prisma.$queryRaw<NeighborRow[]>(
      Prisma.sql`
        SELECT id, category, content, embedding <=> ${qvLit}::vector AS distance
        FROM "memories"
        WHERE "embedding" IS NOT NULL AND "status" = 'ACTIVE' AND ${scopeWhere}
        ORDER BY distance ASC
        LIMIT ${k}
      `
    )

    // EXISTS probe — cheap second query to detect a cold corpus.
    type ExistsRow = { exists: boolean }
    const [existsRow] = await prisma.$queryRaw<ExistsRow[]>(
      Prisma.sql`
        SELECT EXISTS(
          SELECT 1 FROM "memories"
          WHERE "embedding" IS NOT NULL AND "status" = 'ACTIVE' AND ${scopeWhere}
        ) AS exists
      `
    )

    const neighbors = rows.map(r => ({
      id: r.id,
      category: r.category,
      content: r.content,
      score: 1 - r.distance,
    }))

    return {
      neighbors,
      scopeHasEmbeddings: Boolean(existsRow?.exists),
    }
  },

  /**
   * LUM-541 (P5) — read every ACTIVE PROJECT-scope memory's embedding for the
   * batch near-dup clustering sweep. Unlike `findNeighborEmbeddings` (k nearest
   * to one query vector) this returns the WHOLE embedded corpus so the sweep can
   * compute connected near-dup components over it. The `vector(1024)` column is
   * `Unsupported` in Prisma, so it is read as its pgvector text literal
   * (`[0.1,0.2,…]`) and parsed back to numbers here. Rows without an embedding
   * are skipped. `projectId` is bound as a parameter, never interpolated.
   */
  async findActiveProjectMemoryVectors(
    projectId: string
  ): Promise<Array<{ id: string; vector: number[] }>> {
    type Row = { id: string; vector: string | null }
    const rows = await prisma.$queryRaw<Row[]>(
      Prisma.sql`
        SELECT id, "embedding"::text AS vector
        FROM "memories"
        WHERE "projectId" = ${projectId}
          AND "scope" = 'PROJECT'
          AND "status" = 'ACTIVE'
          AND "embedding" IS NOT NULL
      `
    )
    return rows
      .filter((r): r is { id: string; vector: string } => r.vector !== null)
      .map(r => ({
        id: r.id,
        vector: r.vector
          .slice(1, -1) // strip the surrounding [ ]
          .split(',')
          .map(Number),
      }))
  },

  /**
   * Soft-invalidate a memory (LUM-544, DONE-time Layer-1 curation). Flips an
   * ACTIVE row to INVALIDATED and stamps supersededAt as the retire time — but
   * leaves content + the row intact (audit) and writes NO replacement /
   * provenance edge (unlike `supersede`). Invalidate-not-delete per LUM-325's
   * "失效非删" rule. Guarded on status='ACTIVE' so a re-run can't re-stamp an
   * already-retired row; returns how many rows flipped (0 or 1).
   */
  async invalidate(id: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? prisma
    const res = await client.memory.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'INVALIDATED', supersededAt: new Date() },
    })
    return res.count
  },

  /**
   * Hard-delete a memory row. Used by Layer 1 DELETE when the LLM retracts an
   * earlier memory because it was contradicted or superseded.
   */
  async delete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.memory.delete({
      where: { id },
      select: { id: true },
    })
  },

  /**
   * Try to claim the Layer 2 consolidation lease for a project. Atomic: the
   * guarded `updateMany` only matches (and thus only one concurrent caller
   * wins the row lock) when the lease is unset or already expired. Returns
   * true if this caller acquired it, false if another run holds it.
   *
   * This is the cross-instance serialization Layer 2 relies on — `waitUntil`
   * fan-out from concurrent task completions can run in separate serverless
   * instances, so an in-process lock is insufficient; the DB row is the only
   * shared point of truth.
   */
  async tryClaimLayer2Lease(
    projectId: string,
    until: Date,
    now: Date
  ): Promise<boolean> {
    const res = await prisma.project.updateMany({
      where: {
        id: projectId,
        OR: [
          { memoryConsolidationLockedUntil: null },
          { memoryConsolidationLockedUntil: { lt: now } },
        ],
      },
      data: { memoryConsolidationLockedUntil: until },
    })
    return res.count === 1
  },

  /**
   * Release the Layer 2 lease for a project. Uses `updateMany` (not `update`)
   * so a missing/changed row is a no-op rather than a throw — release runs in
   * a `finally` and must never mask the original error.
   */
  async releaseLayer2Lease(projectId: string): Promise<void> {
    await prisma.project.updateMany({
      where: { id: projectId },
      data: { memoryConsolidationLockedUntil: null },
    })
  },

  /**
   * Run a batch of memory mutation plans atomically. Each plan receives the
   * transaction client and is expected to call back into this repository
   * (create / updateContent / delete) so every primitive participates in the
   * same tx. Keeps the layer 1 apply step from having to reach into
   * `@/lib/db/prisma` directly.
   */
  async applyPlansAtomically(
    plans: Array<(tx: Prisma.TransactionClient) => Promise<void>>
  ): Promise<void> {
    await prisma.$transaction(async tx => {
      for (const plan of plans) await plan(tx)
    })
  },
}
