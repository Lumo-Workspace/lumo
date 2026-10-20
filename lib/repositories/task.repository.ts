// LUM-979 + LUM-992: every Task query here runs through the workspace-scope
// check (Task carries a denormalized `workspaceId` since LUM-992). A method
// either pins the caller's workspace or names its cross-tenant reason with
// `unscoped(...)`: tenant resolution (load by bare id to find the workspace
// BEFORE the membership check), a system job, or a "LUM-992 follow-up" read
// that is still scoped only by a parent id the caller already authorized.
import { scopedPrisma as prisma, unscoped } from '@/lib/db/workspace-scope'
import { Prisma as PrismaSql } from '@prisma/client'
import type {
  Prisma,
  TaskStatus,
  TaskPriority,
  AgentStatus,
} from '@prisma/client'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'
import { CLOSED_TASK_STATUSES } from '@/lib/task/status-semantics'

export const WORKSPACE_TASK_QUERY_LIMIT = 500

/** Load a task by bare id to learn its workspace before the access check. */
const TENANT_RESOLUTION =
  'tenant resolution: task loaded by id to find its workspace before the membership check'

/** A background/system path that starts from a bare task id. */
function systemJob(what: string) {
  return unscoped(`system job: ${what}`)
}

/**
 * Still scoped only through a parent (project / sprint / milestone / team /
 * actor) the caller authorized; threading `workspaceId` is LUM-992 follow-up.
 */
function followUp(what: string) {
  return unscoped(`LUM-992 follow-up: ${what}`)
}

export interface WorkspaceTaskFilters {
  projectIds?: string[] | undefined
  milestoneIds?: string[] | undefined
  statuses?: TaskStatus[] | undefined
  priorities?: TaskPriority[] | undefined
  assigneeActorIds?: string[] | undefined
  /** Match tasks with no assignee (ORed with assigneeActorIds when both set). */
  unassigned?: boolean | undefined
  tagIds?: string[] | undefined
  sprintIds?: string[] | undefined
  /** Whitespace-separated terms, all required; each a case-insensitive substring of title/description, or a task number (`42`, `LUM-42`). */
  q?: string | undefined
  /**
   * LUM-821: with `q`, also accept typo-level title matches (pg_trgm word
   * similarity) and return rows ranked by relevance instead of board order.
   */
  fuzzy?: boolean | undefined
  /** Inclusive due-date window bounds (dueBefore is an exclusive upper instant). */
  dueAfter?: Date | undefined
  dueBefore?: Date | undefined
}

/**
 * LUM-1093 / LUM-1233: server-side filters of `lumo task list` — the workspace
 * task query plus the legacy exact project-name match older CLIs send. All
 * optional, ANDed; the assignee scope is decided by the service.
 */
export interface TaskListFilters extends WorkspaceTaskFilters {
  /** Exact project name, case-insensitive (CLI ≤ 1.126.0). */
  projectName?: string | undefined
}

/** Terms shorter than this stay exact — 3-letter trigram sets are too small
 * to tell a typo from an unrelated word (`bug` scores 0.5 against "Budget"). */
export const FUZZY_MIN_TERM_LENGTH = 4
/**
 * Fuzzy acceptance (LUM-821): a term matches a title when its pg_trgm strict
 * word similarity (whole-word extents) is ≥ FUZZY_STRICT. Catches `serch`,
 * `filtr`, `redirct`, `dashbord`, `migraton`, `notifcation`, `isue`; rejects
 * `serch`→"server"/"service", `probe`→"prod"/"prose", `sprint`→"Split
 * printing" (all ≤ 0.375 on real titles).
 *
 * History: a second branch (word ≥ 0.5 ∧ strict ≥ 0.3) once admitted
 * short-word transpositions like `oauht`. Production data showed it cannot be
 * told apart from shared-prefix noise — `oauht`→"OAuth" and `probe`→"prose"
 * score identically (0.500 / 0.333) — so it was dropped. Known misses:
 * transpositions in short words (`oauht`, `reciept`), double deletions.
 *
 * Transpositions come back through a separate, precise mechanism: when a
 * query matches nothing, a fallback pass also accepts titles containing the
 * term with one adjacent pair swapped (see adjacentTranspositions).
 *
 * The matched title word must also be at least (term length − 1) long: a
 * later production run showed `probe` matching "DeepSeek V4-Pro" (strict 0.43
 * against the 3-letter prefix word "pro"), which no typo explains. And the
 * word must be ≥ FUZZY_MIN_TERM_LENGTH: `form` matched every title with
 * "for" (0.5), since 3 ≥ 4 − 1 passed the one-shorter rule.
 */
export const FUZZY_STRICT = 0.4
/**
 * Trigram cut-off used by the fallback tiers, i.e. only after the exact tier
 * matched nothing (see rankTextMatches). Tuned on the 760 production task
 * titles with 235 synthetic typos of the 60 most common words (LUM-821):
 * 0.35 gives 87% recall / 71 noise rows vs 0.40's 80% / 155 (at 0.40 some
 * dropped-letter typos miss the trigram tier and fall through to the noisier
 * swap tier); 0.30 is 91% / 383, 0.25 94% / 1012.
 */
export const FUZZY_FALLBACK_SIMILARITY = 0.35

const TASK_NUMBER_TERM = /^(?:[A-Za-z][A-Za-z0-9]*-)?(\d+)$/

/** Split a query into terms (whitespace, all required). */
export function splitSearchTerms(q: string | undefined): string[] {
  return (q ?? '').trim().split(/\s+/).filter(Boolean)
}

/** Escape LIKE wildcards so a term matches literally (`50%` is not a glob). */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, c => `\\${c}`)}%`
}

/**
 * The ranked text-match query (LUM-821): ids of the workspace's tasks where
 * EVERY term matches, with a relevance score. Per term:
 *   task number = 2.0 · title substring = 1.0 · description substring = 0.5 ·
 *   fuzzy title match (non-numeric terms ≥ FUZZY_MIN_TERM_LENGTH, see FUZZY_STRICT)
 *   = strict similarity × 0.9 — so a typo never outranks an exact hit.
 * Parameterised throughout (Prisma.sql); exported for tests.
 */
/**
 * Every distinct spelling of `term` with one pair of adjacent letters swapped
 * (`oauht` → `aouht`, `ouaht`, `oahut`, `oauth`), case-insensitively deduped
 * and excluding the term itself. Pure; exported for tests.
 */
export function adjacentTranspositions(term: string): string[] {
  const seen = new Set([term.toLowerCase()])
  const out: string[] = []
  for (let i = 0; i < term.length - 1; i++) {
    const v = term.slice(0, i) + term[i + 1] + term[i] + term.slice(i + 2)
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** Whether a term is eligible for typo matching (fuzzy / transpositions). */
function isTypoEligible(term: string): boolean {
  return term.length >= FUZZY_MIN_TERM_LENGTH && !TASK_NUMBER_TERM.test(term)
}

export function buildTextMatchSql(
  workspaceId: string,
  terms: string[],
  limit: number,
  opts: {
    /**
     * Which fallback tier to build (LUM-821): `exact` = substring + number
     * only; `fuzzy` adds trigram typo matching; `swap` adds adjacent-letter
     * swaps on top. rankTextMatches only reaches a tier when the previous
     * one matched nothing. Defaults to `fuzzy` for direct callers/tests.
     */
    tier?: 'exact' | 'fuzzy' | 'swap'
    /** Trigram cut-off for the fuzzy/swap tiers (default FUZZY_STRICT). */
    similarity?: number
  } = {}
): PrismaSql.Sql {
  const tier = opts.tier ?? 'fuzzy'
  const cutoff = opts.similarity ?? FUZZY_STRICT
  const conds: PrismaSql.Sql[] = []
  const scores: PrismaSql.Sql[] = []
  for (const term of terms) {
    const pat = likePattern(term)
    const num = TASK_NUMBER_TERM.exec(term)
    // Identifier / number terms (`42`, `LUM-821`) match exactly: fuzzily,
    // `LUM-821` scores 0.5 against every title quoting another `LUM-71`.
    const fuzzy = tier !== 'exact' && isTypoEligible(term)
    const alts: PrismaSql.Sql[] = [
      PrismaSql.sql`t."title" ILIKE ${pat}`,
      PrismaSql.sql`t."description" ILIKE ${pat}`,
    ]
    const parts: PrismaSql.Sql[] = [
      PrismaSql.sql`CASE WHEN t."title" ILIKE ${pat} THEN 1.0 ELSE 0 END`,
      PrismaSql.sql`CASE WHEN t."description" ILIKE ${pat} THEN 0.5 ELSE 0 END`,
    ]
    if (fuzzy) {
      // `<<%` (GUC threshold FUZZY_STRICT, set in rankTextMatches) is the
      // index-served pre-filter; the EXISTS then requires the matched title
      // WORD to be at most one character shorter than the term — a typo drops
      // a letter, not a syllable. Without it `probe` matched "V4-Pro" (0.43).
      // The word must also be ≥ FUZZY_MIN_TERM_LENGTH: 3-letter words are as
      // noisy on the title side as on the query side (`form` → "for", 0.5).
      const hit = PrismaSql.sql`(${term} <<% t."title" AND EXISTS (SELECT 1 FROM regexp_split_to_table(lower(t."title"), '[^[:alnum:]]+') w WHERE length(w) >= GREATEST(length(${term}) - 1, ${FUZZY_MIN_TERM_LENGTH}) AND similarity(${term}, w) >= ${cutoff}))`
      alts.push(hit)
      parts.push(
        PrismaSql.sql`CASE WHEN ${hit} THEN strict_word_similarity(${term}, t."title") * 0.9 ELSE 0 END`
      )
    }
    if (fuzzy && tier === 'swap') {
      // Fallback pass only (see rankTextMatches): the title contains the term
      // with one adjacent pair swapped — `oauht` finds "OAuth", a case trigram
      // similarity cannot separate from shared-prefix noise. Scored below a
      // trigram typo hit.
      const variants = adjacentTranspositions(term)
      if (variants.length) {
        const swap = PrismaSql.sql`(${PrismaSql.join(
          variants.map(v => PrismaSql.sql`t."title" ILIKE ${likePattern(v)}`),
          ' OR '
        )})`
        alts.push(swap)
        parts.push(PrismaSql.sql`CASE WHEN ${swap} THEN 0.85 ELSE 0 END`)
      }
    }
    if (num) {
      const n = Number(num[1])
      alts.push(PrismaSql.sql`t."number" = ${n}`)
      parts.push(PrismaSql.sql`CASE WHEN t."number" = ${n} THEN 2.0 ELSE 0 END`)
    }
    conds.push(PrismaSql.sql`(${PrismaSql.join(alts, ' OR ')})`)
    scores.push(PrismaSql.sql`GREATEST(${PrismaSql.join(parts, ', ')})`)
  }
  return PrismaSql.sql`
    SELECT t."id" AS id, (${PrismaSql.join(scores, ' + ')})::float AS score
    FROM "tasks" t
    JOIN "projects" p ON p."id" = t."projectId"
    WHERE p."workspaceId" = ${workspaceId}
      AND t."deletedAt" IS NULL
      AND ${PrismaSql.join(conds, ' AND ')}
    ORDER BY score DESC, t."updatedAt" DESC
    LIMIT ${limit}
  `
}

export interface TaskUpdateData {
  title?: string | undefined
  description?: string | null | undefined
  spec?: string | null | undefined
  status?: TaskStatus | string | undefined
  priority?: TaskPriority | string | undefined
  order?: number | undefined
  dueDate?: string | Date | null | undefined
  assigneeActorId?: string | null | undefined
  projectId?: string | undefined
  sprintId?: string | null | undefined
  milestoneId?: string | null | undefined
  claimable?: boolean | undefined
  agentStatus?: AgentStatus | null | undefined
  agentError?: string | null | undefined
  workStartedAt?: Date | null | undefined
  /** LUM-1282: terminal stamps, written only via `terminalTimestampPatch`. */
  completedAt?: Date | null | undefined
  canceledAt?: Date | null | undefined
}

/** Full detail include for single task view. Used by GET /api/tasks/[id] and task detail pages. */
const TASK_DETAIL_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      workspaceId: true,
      ownerId: true,
    },
  },
  team: { select: { identifier: true, sprintsEnabled: true } },
  assignee: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
      agent: { select: { id: true, name: true, avatarColor: true } },
    },
  },
  pullRequests: {
    select: {
      id: true,
      number: true,
      title: true,
      url: true,
      state: true,
      authorLogin: true,
      headBranch: true,
      // LUM-825: lets the CLI tell a squash-merged worktree branch (local HEAD
      // == the merged PR's head) from one with commits added after the merge.
      headSha: true,
      ciStatus: true,
      mergedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  branches: {
    select: {
      id: true,
      repo: true,
      branchName: true,
      lastCommitSha: true,
      lastCommitMessage: true,
      lastCommitAuthor: true,
      lastPushedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  sprint: {
    select: {
      id: true,
      status: true,
      name: true,
    },
  },
  milestone: {
    select: {
      id: true,
      completedAt: true,
      name: true,
    },
  },
} as const

/** Include for task update operations (lighter than full detail). */
const TASK_UPDATE_INCLUDE = {
  project: {
    include: {
      owner: { select: { id: true, clerkId: true } },
      workspace: { select: { slug: true } },
    },
  },
  team: { select: { identifier: true } },
} as const

/** Shared include for list endpoints (project, sprint, team task lists).
 * Matches the shape expected by BoardView and the Kanban board.
 */
const TASK_LIST_INCLUDE = {
  team: { select: { identifier: true } },
  // Board filtering also offers sprint / milestone, which need names not just
  // the scalar FKs. Same shape as TASK_DETAIL_INCLUDE so the JSON contract for
  // `task.sprint` / `task.milestone` is identical everywhere.
  sprint: { select: { id: true, status: true, name: true } },
  milestone: {
    select: { id: true, completedAt: true, name: true, archivedAt: true },
  },
  // Board filtering needs each task's labels; lifted to a flat `tags` array by
  // the shapers in lib/api/task-shape.ts so the join rows never reach the client.
  taskTags: { select: { tag: true } },
  assignee: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
      agent: { select: { id: true, name: true, avatarColor: true } },
    },
  },
} as const

/**
 * Workspace task query rows: the list include plus the project name so CLI
 * search rows can show it (the shared list include stays untouched for board
 * consumers).
 */
const WORKSPACE_SEARCH_INCLUDE = {
  ...TASK_LIST_INCLUDE,
  project: { select: { id: true, name: true } },
} as const

/** Fuzzy relevance order: highest score first (stable for equal scores). */
function sortByRank<T extends { id: string }>(
  rows: T[],
  rank: Map<string, number>
): T[] {
  return [...rows].sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0))
}

/** Agent-state fields + workspace pointer for cancel / resume / status / confirm-spec / respond. */
const TASK_AGENT_SELECT = {
  id: true,
  status: true,
  agentStatus: true,
  inputReason: true,
  projectId: true,
  project: { select: { workspaceId: true } },
} as const

/** Title / description / identifier needed by Layer 1 memory extraction and lumo-proposal flows. */
const TASK_MEMORY_CONTEXT_SELECT = {
  id: true,
  title: true,
  description: true,
  number: true,
  projectId: true,
  project: { select: { workspaceId: true } },
  team: { select: { identifier: true } },
} as const

/** Comment-creation context: needs team identifier + workspace slug to build mention links. */
const TASK_COMMENT_SELECT = {
  id: true,
  projectId: true,
  number: true,
  title: true,
  team: { select: { identifier: true } },
  project: {
    select: {
      name: true,
      workspaceId: true,
      workspace: { select: { slug: true } },
    },
  },
} as const

/** Sprint-gate fields used by sprintRepository to validate task-sprint membership. */
const TASK_MINIMAL_SELECT = {
  id: true,
  teamId: true,
  sprintId: true,
} as const

/** Shape returned when resolving "LUM-30"-style identifiers to a task row. */
const TASK_IDENTIFIER_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  team: { select: { identifier: true } },
} as const

/** Auth check: full task row + only the project's workspaceId. Used by many tasks/[id]/* routes. */
const TASK_AUTH_INCLUDE = {
  project: { select: { workspaceId: true } },
} as const

/** Recent-tasks shape fed to the AI duplicate-check prompt. */
const TASK_DUPLICATE_CHECK_SELECT = {
  id: true,
  title: true,
  number: true,
  status: true,
  priority: true,
  team: { select: { identifier: true } },
  assignee: {
    select: {
      type: true,
      member: { select: { clerkId: true } },
      agent: { select: { name: true } },
    },
  },
} as const

/** Assignee-board shape: project owner actor + team identifier. */
const TASK_ASSIGNED_INCLUDE = {
  // Board filtering also offers sprint / milestone, which need names not just
  // the scalar FKs. Same shape as TASK_DETAIL_INCLUDE so the JSON contract for
  // `task.sprint` / `task.milestone` is identical everywhere.
  sprint: { select: { id: true, status: true, name: true } },
  milestone: {
    select: { id: true, completedAt: true, name: true, archivedAt: true },
  },
  // See TASK_LIST_INCLUDE — same flat-`tags` contract for assigned-task lists.
  taskTags: { select: { tag: true } },
  project: {
    select: {
      id: true,
      name: true,
      owner: { select: { actor: { select: { id: true } } } },
    },
  },
  team: { select: { identifier: true } },
  assignee: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
      agent: { select: { id: true, name: true, avatarColor: true } },
    },
  },
} as const

export const taskRepository = {
  /** Find a task by ID with full detail relations. */
  async findById(id: string) {
    return unscoped(TENANT_RESOLUTION).task.findUnique({
      where: { id },
      include: TASK_DETAIL_INCLUDE,
    })
  },

  /**
   * Tasks eligible for claim-faithfulness judging — DONE or IN_REVIEW, newest
   * claim first. Carries claimSnapshotAt (claim-staleness axis) plus the current
   * merged-PR set (LUM-618 delivery-growth axis) so the sweep can decide both
   * freshness axes without reloading each task (judgeTask reloads full inputs).
   */
  async listFaithfulnessCandidates() {
    const rows = await systemJob(
      'claim-faithfulness sweep scans every workspace'
    ).task.findMany({
      where: { status: { in: ['DONE', 'IN_REVIEW'] } },
      select: {
        id: true,
        claimSnapshotAt: true,
        team: { select: { workspaceId: true } },
        pullRequests: {
          where: { state: 'merged' },
          select: { number: true },
        },
      },
      orderBy: { claimSnapshotAt: 'desc' },
    })
    return rows.map(r => ({
      id: r.id,
      claimSnapshotAt: r.claimSnapshotAt,
      workspaceId: r.team.workspaceId,
      mergedPrNumbers: r.pullRequests.map(p => p.number),
    }))
  },

  /**
   * Lightweight status read for the lineage birth-time backfill (LUM-296).
   * Selects only `status` to avoid hydrating the full detail graph on the hot
   * session-start path. Returns null when the task doesn't exist.
   */
  async getStatus(id: string): Promise<TaskStatus | null> {
    const row = await followUp(
      'lineage birth-time status read by task id'
    ).task.findUnique({
      where: { id },
      select: { status: true },
    })
    return row?.status ?? null
  },

  /**
   * Lightweight title+status read for the fragment-usage audit (LUM-314).
   * Returns null when the task doesn't exist.
   */
  async getTitleAndStatus(taskId: string) {
    return systemJob(
      'run-summary / memory curation / fragment-usage audit start from a task id'
    ).task.findUnique({
      where: { id: taskId },
      select: {
        title: true,
        status: true,
        // LUM-778: the usage audit reads the constitution per (project, workspace).
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    })
  },

  /**
   * LUM-573: freeze the synthesized task-level claim snapshot. `at` (non-null)
   * is the "snapshot synthesized" watermark the read path uses to decide a
   * field read vs the live latest-session fallback — so a null `text` (the
   * delivery session had no material) is still an authoritative, fail-closed
   * answer once `claimSnapshotAt` is set, not a cue to fall back.
   */
  async setClaimSnapshot(
    taskId: string,
    snapshot: {
      text: string | null
      // LUM-597: 'AGENT' = the agent's own self-report (legacy rows from the
      // removed `lumo verify --note`; nothing writes it since LUM-942).
      source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
      sessionId: string | null
      at: Date
    }
  ) {
    return systemJob('claim-snapshot synthesis worker').task.update({
      where: { id: taskId },
      data: {
        ...redactStoredFields(
          { claimSnapshot: snapshot.text },
          STORAGE_REDACTED_FIELDS.task
        ),
        claimSnapshotSource: snapshot.source,
        claimSnapshotSessionId: snapshot.sessionId,
        claimSnapshotAt: snapshot.at,
      },
      select: { id: true },
    })
  },

  /**
   * LUM-573: the frozen claim snapshot for the read model. `synthesizedAt` is
   * null when no snapshot has been frozen yet (the read path then falls back to
   * the live latest-session claim). Returns null only when the task is gone.
   */
  async loadClaimSnapshot(taskId: string) {
    return followUp(
      'claim snapshot read (snapshot worker + task status read model)'
    ).task.findUnique({
      where: { id: taskId },
      select: {
        claimSnapshot: true,
        claimSnapshotSource: true,
        claimSnapshotAt: true,
      },
    })
  },

  /** LUM-970: just the stored (HTML) description, for `task decide`. */
  async findDescription(id: string, workspaceId: string) {
    return prisma.task.findUnique({
      where: { id, workspaceId },
      select: { description: true },
    })
  },

  /**
   * LUM-1149: what the linked task / issue assessment reads off a PR's task —
   * its identifier, title and stored (HTML) description — within
   * `workspaceId`. A trashed task reads as missing.
   */
  async findForRequirements(id: string, workspaceId: string) {
    return prisma.task.findFirst({
      where: { id, workspaceId, deletedAt: null },
      select: {
        number: true,
        title: true,
        description: true,
        team: { select: { identifier: true } },
      },
    })
  },

  /**
   * Find a task by ID with update-related relations (project + team), within
   * `workspaceId`: another workspace's task reads as missing (LUM-992).
   */
  async findForUpdate(id: string, workspaceId: string) {
    return prisma.task.findUnique({
      where: { id, workspaceId },
      include: TASK_UPDATE_INCLUDE,
    })
  },

  /**
   * Batch variant of {@link findForUpdate}. Returns a Map keyed by id so the
   * caller can look up each row without scanning, and skips fetching when
   * `ids` is empty. Used by quick-dispatch to pre-fetch all tasks in a batch
   * with one query instead of fetching per-action.
   */
  async findManyForUpdate(ids: string[], workspaceId: string) {
    if (ids.length === 0) return new Map<string, never>()
    const rows = await prisma.task.findMany({
      where: { id: { in: ids }, workspaceId },
      include: TASK_UPDATE_INCLUDE,
    })
    return new Map(rows.map(row => [row.id, row]))
  },

  /** Find a task by ID with only the project relation (for auth checks). */
  async findWithProject(id: string) {
    return unscoped(TENANT_RESOLUTION).task.findUnique({
      where: { id },
      include: { project: true },
    })
  },

  /**
   * Resolve a workspace-scoped task identifier like "LUM-30" into a compact
   * record. Returns null if no matching task exists in the given workspace.
   */
  async findByWorkspaceIdentifier(
    workspaceId: string,
    teamIdentifier: string,
    number: number
  ) {
    return prisma.task.findFirst({
      where: {
        workspaceId,
        number,
        team: { identifier: teamIdentifier, workspaceId },
      },
      select: { ...TASK_IDENTIFIER_SELECT, workStartedAt: true },
    })
  },

  /**
   * Compact header (identifier parts + title + status) by cuid. Read models
   * that already resolved the task use this instead of a full detail fetch.
   */
  async findHeaderById(id: string) {
    return followUp(
      'header by task id (status read model, security reminder, remediation link)'
    ).task.findUnique({
      where: { id },
      select: TASK_IDENTIFIER_SELECT,
    })
  },

  /**
   * Update a task's fields within `workspaceId` (another workspace's id is
   * P2025). A `projectId` in `data` must be a project of the same workspace —
   * the service validates it and the DB trigger rejects a mismatch.
   */
  async update(id: string, workspaceId: string, data: TaskUpdateData) {
    return prisma.task.update({
      where: { id, workspaceId },
      data: redactStoredFields(
        data,
        STORAGE_REDACTED_FIELDS.task
      ) as Parameters<typeof prisma.task.update>[0]['data'],
      include: {
        project: { select: { id: true, name: true } },
        team: { select: { identifier: true } },
      },
    })
  },

  /** Delete a task by ID within `workspaceId`. */
  async delete(id: string, workspaceId: string) {
    await prisma.task.delete({ where: { id, workspaceId } })
  },

  /** Find task status by ID (lightweight query for state machine), within `workspaceId`. */
  async findStatus(id: string, workspaceId: string) {
    return prisma.task.findUnique({
      where: { id, workspaceId },
      select: { status: true },
    })
  },

  /** Find a task with agent-related fields, within `workspaceId`. Used by cancel, resume, status, confirm-spec, and respond routes. */
  async findForAgent(id: string, workspaceId: string) {
    return prisma.task.findUnique({
      where: { id, workspaceId },
      select: TASK_AGENT_SELECT,
    })
  },

  /** Find only the projectId for a task (security-hunt task context). */
  async findProjectId(id: string) {
    return systemJob('security hunt reads the task project').task.findUnique({
      where: { id },
      select: { projectId: true },
    })
  },

  /**
   * Compact lookup for Layer 1 memory extraction: returns the fields the
   * extraction prompt needs (task title/description as context) plus the
   * project + workspace IDs needed to write Memory rows.
   */
  async findForMemoryContext(id: string) {
    return systemJob('Layer 1 memory extraction').task.findUnique({
      where: { id },
      select: TASK_MEMORY_CONTEXT_SELECT,
    })
  },

  /** Clear agentError on a task within `workspaceId`. */
  async clearAgentError(id: string, workspaceId: string) {
    return prisma.task.update({
      where: { id, workspaceId },
      data: { agentError: null },
    })
  },

  /** Save a confirmed spec and clear agentError, within `workspaceId`. */
  async updateSpec(id: string, workspaceId: string, spec: string) {
    return prisma.task.update({
      where: { id, workspaceId },
      data: {
        ...redactStoredFields({ spec }, STORAGE_REDACTED_FIELDS.task),
        agentError: null,
      },
    })
  },

  /** Update a single task's sprintId, within `workspaceId`. */
  async updateSprint(
    taskId: string,
    workspaceId: string,
    sprintId: string | null,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.task.update({
      where: { id: taskId, workspaceId },
      data: { sprintId },
    })
  },

  /** Bulk update multiple tasks' sprintId. */
  async bulkUpdateSprint(
    taskIds: string[],
    sprintId: string | null,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? followUp('sprint spillover by task ids')
    return client.task.updateMany({
      where: { id: { in: taskIds } },
      data: { sprintId },
    })
  },

  /** Find all tasks assigned to an actor, with project/team details. */
  async findAssignedTasks(
    actorId: string,
    opts: { sprintIds?: string[] } = {}
  ) {
    return followUp('tasks assigned to an actor').task.findMany({
      where: {
        assigneeActorId: actorId,
        ...(opts.sprintIds?.length ? { sprintId: { in: opts.sprintIds } } : {}),
      },
      include: TASK_ASSIGNED_INCLUDE,
      orderBy: { order: 'asc' },
    })
  },

  /**
   * LUM-1233: one page of `lumo task list` — the workspace task query
   * (same WHERE, order and fuzzy ranking as `findByWorkspaceWithFiltersPage`)
   * in the assigned-task row shape, plus the whole filtered set's size.
   */
  async findTaskListPage(
    workspaceId: string,
    filters: TaskListFilters,
    page: { offset: number; limit: number }
  ) {
    return pageWorkspaceQuery(workspaceId, filters, page, TASK_ASSIGNED_INCLUDE)
  },

  /** Lightweight summary of tasks assigned to an actor — for Quick Dispatch AI context. */
  async findAssignedTasksSummary(actorId: string) {
    return followUp('tasks assigned to an actor').task.findMany({
      where: { assigneeActorId: actorId },
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        team: { select: { identifier: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
  },

  /** Find tasks for duplicate checking (recent 200 tasks in a project). */
  async findForDuplicateCheck(projectId: string) {
    return followUp('tasks of an authorized project').task.findMany({
      where: { projectId },
      select: TASK_DUPLICATE_CHECK_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
  },

  /** Find recent tasks in a project (for AI context). */
  async findRecentByProject(projectId: string, take: number) {
    return followUp('tasks of an authorized project').task.findMany({
      where: { projectId },
      select: { title: true, description: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
  },

  /** Find historical tasks with priority info (for AI priority suggestion). */
  async findHistoricalByProject(projectId: string, take: number) {
    return followUp('tasks of an authorized project').task.findMany({
      where: { projectId },
      select: { id: true, number: true, title: true, priority: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
  },

  /** LUM-923: true only when the task exists and sits in the trash. */
  async isTrashed(id: string): Promise<boolean> {
    const n = await systemJob(
      'boundary detector checks the trash by task id'
    ).task.count({
      where: { id, deletedAt: { not: null } },
    })
    return n > 0
  },

  /** Find a task by ID with only project workspaceId (for auth checks). */
  async findWithProjectWorkspaceId(id: string) {
    return unscoped(TENANT_RESOLUTION).task.findUnique({
      where: { id },
      include: TASK_AUTH_INCLUDE,
    })
  },

  /** Find a task with comment-creation fields (id, projectId, number, title, team, project workspace). */
  async findForComment(id: string) {
    return unscoped(TENANT_RESOLUTION).task.findUnique({
      where: { id },
      select: TASK_COMMENT_SELECT,
    })
  },

  /** Find all tasks for a project with full list details (for project task list).
   * @param sprintId    - undefined: no sprint filter; null: only backlog (sprintId IS NULL); string: only that sprint
   * @param milestoneId - undefined: no milestone filter; null: only tasks with no milestone; string: only that milestone
   */
  async findByProjectWithDetails(
    projectId: string,
    sprintId?: string | null,
    milestoneId?: string | null
  ) {
    const where: Prisma.TaskWhereInput = { projectId }
    if (sprintId !== undefined) {
      where.sprintId = sprintId === null ? null : sprintId
    }
    if (milestoneId !== undefined) {
      where.milestoneId = milestoneId === null ? null : milestoneId
    }
    return followUp('tasks of an authorized project').task.findMany({
      where,
      include: TASK_LIST_INCLUDE,
      orderBy: { order: 'asc' },
    })
  },

  /** Find all tasks in a workspace, optionally filtered by project, milestone, status, priority, assignee, and tags.
   * Capped at WORKSPACE_TASK_QUERY_LIMIT results, ordered by task order.
   * Used by the workspace-wide task view (LUM-224).
   */
  async findByWorkspaceWithFilters(
    workspaceId: string,
    filters: WorkspaceTaskFilters = {}
  ) {
    const { where, rank } = await buildWorkspaceWhere(workspaceId, filters)
    const rows = await prisma.task.findMany({
      where,
      include: WORKSPACE_SEARCH_INCLUDE,
      orderBy: { order: 'asc' },
      take: WORKSPACE_TASK_QUERY_LIMIT,
    })
    if (!rank) return rows
    return sortByRank(rows, rank)
  },

  /**
   * LUM-1093: one page of the workspace task query plus the size of the whole
   * filtered result. Board order (id breaks ties so pages never overlap);
   * fuzzy queries keep their relevance order, and their match set is already
   * capped at WORKSPACE_TASK_QUERY_LIMIT by rankTextMatches.
   */
  async findByWorkspaceWithFiltersPage(
    workspaceId: string,
    filters: WorkspaceTaskFilters,
    page: { offset: number; limit: number }
  ) {
    return pageWorkspaceQuery(
      workspaceId,
      filters,
      page,
      WORKSPACE_SEARCH_INCLUDE
    )
  },

  /**
   * LUM-821: ranked text matches for fuzzy search (see buildTextMatchSql).
   * The `<<%` operator reads its cut-off from a GUC, so it is set
   * transaction-locally in the same batch — never leaking to other queries
   * on a pooled connection.
   */
  async rankTextMatches(
    workspaceId: string,
    terms: string[]
  ): Promise<Array<{ id: string; score: number }>> {
    type Row = { id: string; score: number }
    // Tiered fallback (LUM-821). A production sweep of the 200 most common
    // title words showed every fuzzy false positive had the same shape: a
    // CORRECT word that already had exact hits got widened into a similar
    // real word (content→context ×26, active→action, lineage→linear…). No
    // trigram threshold separates those. So typo tolerance only runs when the
    // query matches nothing exactly — and the swap tier only when the trigram
    // tier matches nothing too.
    const exact = await prisma.$queryRaw<Row[]>(
      buildTextMatchSql(workspaceId, terms, WORKSPACE_TASK_QUERY_LIMIT, {
        tier: 'exact',
      })
    )
    if (exact.length > 0 || !terms.some(isTypoEligible)) return exact
    // The `<<%` operator reads its cut-off from a GUC, so it is set
    // transaction-locally in the same batch — never leaking on a pooled
    // connection.
    const run = async (tier: 'fuzzy' | 'swap') => {
      const [, rows] = await prisma.$transaction([
        prisma.$queryRaw`SELECT set_config('pg_trgm.strict_word_similarity_threshold', ${String(FUZZY_FALLBACK_SIMILARITY)}, true)`,
        prisma.$queryRaw<Row[]>(
          buildTextMatchSql(workspaceId, terms, WORKSPACE_TASK_QUERY_LIMIT, {
            tier,
            similarity: FUZZY_FALLBACK_SIMILARITY,
          })
        ),
      ])
      return rows
    }
    const fuzzy = await run('fuzzy')
    if (fuzzy.length > 0) return fuzzy
    return run('swap')
  },

  /** Find tasks under a milestone, optionally filtered by assignee.
   * Used by GET /api/milestones/[id]/tasks (milestone show + task list --milestone).
   */
  async findByMilestone(opts: {
    milestoneId: string
    assigneeActorId?: string
  }) {
    const where: Prisma.TaskWhereInput = { milestoneId: opts.milestoneId }
    if (opts.assigneeActorId) {
      where.assigneeActorId = opts.assigneeActorId
    }
    return followUp('tasks of an authorized milestone').task.findMany({
      where,
      include: TASK_ASSIGNED_INCLUDE,
      orderBy: { order: 'asc' },
    })
  },

  /** Find all tasks for a sprint (across all projects in the team).
   * Used by GET /api/sprints/[sprintId]/tasks for the Sprint Board.
   *
   * Includes the project relation (with owner actor) so the response can
   * serve MyTask-shaped callers (TaskWorkspace view on the sprint page).
   */
  async findBySprint(sprintId: string) {
    return followUp('tasks of an authorized sprint').task.findMany({
      where: { sprintId },
      include: {
        ...TASK_LIST_INCLUDE,
        project: {
          select: {
            id: true,
            name: true,
            owner: { select: { actor: { select: { id: true } } } },
          },
        },
      },
      orderBy: { order: 'asc' },
    })
  },

  /** Find all tasks for a team (across all projects).
   * @param sprintId - undefined: no sprint filter; null: only backlog (sprintId IS NULL); string: only that sprint
   * Used by GET /api/teams/[teamId]/tasks for the Backlog panel.
   */
  async findByTeamWithDetails(teamId: string, sprintId?: string | null) {
    const where: Prisma.TaskWhereInput = { teamId }
    if (sprintId !== undefined) {
      where.sprintId = sprintId === null ? null : sprintId
    }
    return followUp('tasks of an authorized team').task.findMany({
      where,
      include: TASK_LIST_INCLUDE,
      orderBy: { order: 'asc' },
    })
  },

  /** Find the max order among a project's tasks. */
  async findMaxOrder(projectId: string) {
    return followUp('tasks of an authorized project').task.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    })
  },

  /**
   * Find an actor by ID within `workspaceId` (assignee validation): another
   * workspace's actor reads as missing.
   */
  async findActorById(actorId: string, workspaceId: string) {
    return prisma.actor.findUnique({
      where: { id: actorId, workspaceId },
      select: { type: true, workspaceId: true },
    })
  },

  /** Find an actor by ID with member clerkId (for notification), within `workspaceId`. */
  async findActorWithMember(actorId: string, workspaceId: string) {
    return prisma.actor.findUnique({
      where: { id: actorId, workspaceId },
      select: { type: true, member: { select: { clerkId: true } } },
    })
  },

  /** Create a task in a transaction (with team seq increment). Returns the created task with team + assignee. */
  async createWithSequence(data: {
    /** The project's workspace — scopes the team-sequence bump (LUM-979). */
    workspaceId: string
    projectId: string
    teamId: string
    title: string
    description: string | null
    status: TaskStatus
    priority: TaskPriority
    assigneeActorId: string | null
    agentStatus: AgentStatus | null
    sprintId?: string | null
    milestoneId?: string | null
    order: number | undefined
    dueDate: Date | string | null
    /** LUM-1282: set when the task is born DONE. */
    completedAt?: Date | null
  }) {
    const taskId = await prisma.$transaction(async tx => {
      const { taskSeq } = await tx.team.update({
        where: { id: data.teamId, workspaceId: data.workspaceId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true },
      })

      const task = await tx.task.create({
        data: {
          projectId: data.projectId,
          // LUM-992: the project's workspace. The DB trigger rejects a
          // project from another workspace.
          workspaceId: data.workspaceId,
          teamId: data.teamId,
          number: taskSeq,
          ...redactStoredFields(
            { title: data.title, description: data.description },
            STORAGE_REDACTED_FIELDS.task
          ),
          status: data.status,
          priority: data.priority,
          assigneeActorId: data.assigneeActorId,
          agentStatus: data.agentStatus,
          sprintId: data.sprintId ?? null,
          milestoneId: data.milestoneId ?? null,
          ...(data.order !== undefined ? { order: data.order } : {}),
          dueDate: data.dueDate,
          ...(data.completedAt ? { completedAt: data.completedAt } : {}),
        },
      })

      return task.id
    })

    // Re-fetch with includes outside transaction for proper type inference
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId, workspaceId: data.workspaceId },
      include: {
        team: { select: { identifier: true } },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
      },
    })

    return {
      ...task,
      teamIdentifier: task.team.identifier,
    }
  },

  /**
   * Resolve a workspace-scoped task by cuid, returning only the fields needed
   * to reconstruct its human identifier (TEAM-N). Used by documentService when
   * the caller passes a raw cuid instead of a "LUM-N" string.
   */
  async findByIdForMention(id: string, workspaceId: string) {
    return prisma.task.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        number: true,
        status: true,
        workStartedAt: true,
        team: { select: { identifier: true } },
      },
    })
  },

  /**
   * Lightweight lookup returning only fields sprintService needs for gate checks.
   * Used by addTaskToSprint / removeTaskFromSprint to validate team match
   * and membership without loading unrelated fields.
   */
  async findMinimalById(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? followUp('sprint add/remove by task id')
    return client.task.findUnique({
      where: { id: taskId },
      select: TASK_MINIMAL_SELECT,
    })
  },

  /**
   * Return all tasks on `sprintId` that are not closed (DONE or CANCELED).
   * Used inside sprint close to decide which tasks need a spillover decision.
   * Must be called within a transaction — no default prisma fallback.
   */
  async findUnfinishedBySprint(sprintId: string, tx: Prisma.TransactionClient) {
    return tx.task.findMany({
      where: { sprintId, status: { notIn: [...CLOSED_TASK_STATUSES] } },
      select: { id: true, status: true },
    })
  },

  /**
   * Ids of every open (not DONE / CANCELED) task on `sprintId`, read outside any transaction.
   * Used by the automated sprint-close reconcile to build "all → backlog"
   * spillover decisions before delegating to the transactional close.
   */
  async listUnfinishedIdsBySprint(sprintId: string): Promise<{ id: string }[]> {
    return followUp('tasks of an authorized sprint').task.findMany({
      where: { sprintId, status: { notIn: [...CLOSED_TASK_STATUSES] } },
      select: { id: true },
    })
  },

  /**
   * Return the minimal task fields needed for sprint-summary stats.
   * Used by sprintSummaryRepository.computeStatsData().
   */
  async listBySprintForStats(sprintId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? followUp('tasks of an authorized sprint')
    return client.task.findMany({
      where: { sprintId },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeActorId: true,
        title: true,
      },
    })
  },

  /**
   * Lightweight task projection for a milestone, used by
   * milestoneSummaryRepository.computeStatsData().
   */
  async listByMilestoneForStats(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? followUp('tasks of an authorized milestone')
    return client.task.findMany({
      where: { milestoneId },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeActorId: true,
        title: true,
      },
    })
  },

  /**
   * LUM-649 changelog projection: every task in the milestone (all statuses —
   * the service filters to DONE, so the honest boundary lives in one place)
   * with the identifier parts, title, frozen claimSnapshot fields, and
   * `updatedAt` (the best-available "last moved" proxy — Task has no
   * completedAt column) for newest-first ordering.
   */
  async listByMilestoneForChangelog(milestoneId: string) {
    return followUp('tasks of an authorized milestone').task.findMany({
      where: { milestoneId },
      select: {
        id: true,
        status: true,
        number: true,
        title: true,
        updatedAt: true,
        claimSnapshot: true,
        claimSnapshotSource: true,
        claimSnapshotSessionId: true,
        claimSnapshotAt: true,
        team: { select: { identifier: true } },
      },
    })
  },

  /**
   * LUM-649 baseline sample: DONE-task count grouped per milestone, for a set
   * of prior COMPLETED milestones (the changelog headline's reference class).
   * A prior milestone with zero DONE tasks is simply absent — the service
   * reads a missing group as 0.
   */
  async countDoneByMilestones(
    milestoneIds: string[]
  ): Promise<Array<{ milestoneId: string; count: number }>> {
    if (milestoneIds.length === 0) return []
    const rows = await followUp('tasks of authorized milestones').task.groupBy({
      by: ['milestoneId'],
      where: { milestoneId: { in: milestoneIds }, status: 'DONE' },
      _count: { _all: true },
    })
    return rows
      .filter(
        (r): r is typeof r & { milestoneId: string } => r.milestoneId !== null
      )
      .map(r => ({ milestoneId: r.milestoneId, count: r._count._all }))
  },

  /**
   * Cache the LLM-generated comment-thread summary on the task row.
   * Part of the context-injection tiering pipeline (LUM-122): comment threads
   * have no standalone entity, so the cached summary lives on Task.
   */
  async updateCommentsSummary(taskId: string, summary: string) {
    return systemJob('background comment-summary cache write').task.update({
      where: { id: taskId },
      data: {
        ...redactStoredFields(
          { commentsSummary: summary },
          STORAGE_REDACTED_FIELDS.task
        ),
        commentsSummaryAt: new Date(),
      },
    })
  },

  /**
   * Resolve a batch of `(team identifier, number)` pairs to status + PR state,
   * scoped to a single workspace. Pairs the caller can't see are simply absent
   * from the result — the mention renderer degrades those to a plain chip.
   */
  async findManyForMentionStatus(
    workspaceId: string,
    identifiers: { prefix: string; number: number }[]
  ) {
    return prisma.task.findMany({
      where: {
        workspaceId,
        OR: identifiers.map(p => ({
          number: p.number,
          team: { identifier: p.prefix },
        })),
      },
      select: {
        number: true,
        status: true,
        team: { select: { identifier: true } },
        pullRequests: { select: { state: true } },
      },
    })
  },
}

/**
 * One page of the workspace task query plus the size of the whole filtered
 * result, loaded with `include`. Board order (id breaks ties so pages never
 * overlap); fuzzy queries keep their relevance order, and their match set is
 * already capped at WORKSPACE_TASK_QUERY_LIMIT by rankTextMatches.
 */
async function pageWorkspaceQuery<I extends Prisma.TaskInclude>(
  workspaceId: string,
  filters: TaskListFilters,
  page: { offset: number; limit: number },
  include: I
) {
  const { where, rank } = await buildWorkspaceWhere(workspaceId, filters)
  if (rank) {
    // Rank over ids only (the filtered match set is at most the cap), then
    // load the full rows for just this page.
    const ids = await prisma.task.findMany({
      where,
      select: { id: true },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      take: WORKSPACE_TASK_QUERY_LIMIT,
    })
    const pageIds = sortByRank(ids, rank)
      .slice(page.offset, page.offset + page.limit)
      .map(r => r.id)
    const full = pageIds.length
      ? await prisma.task.findMany({
          where: { workspaceId, id: { in: pageIds } },
          include,
        })
      : []
    const byId = new Map(full.map(r => [r.id, r]))
    return {
      rows: pageIds.flatMap(id => {
        const r = byId.get(id)
        return r ? [r] : []
      }),
      total: ids.length,
      // The ranked match set stops at the cap, so `total` is a floor.
      truncated: rank.size >= WORKSPACE_TASK_QUERY_LIMIT,
    }
  }
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include,
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      skip: page.offset,
      take: page.limit,
    }),
  ])
  return { rows, total, truncated: false }
}

/**
 * The workspace task query's WHERE (+ fuzzy relevance ranks, if any). A
 * module function, not a repository method, so no caller depends on `this`.
 */
async function buildWorkspaceWhere(
  workspaceId: string,
  filters: TaskListFilters
): Promise<{
  where: Prisma.TaskWhereInput
  rank: Map<string, number> | null
}> {
  const where: Prisma.TaskWhereInput = { workspaceId }
  if (filters.projectIds?.length) {
    where.projectId = { in: filters.projectIds }
  }
  if (filters.projectName) {
    where.project = {
      name: { equals: filters.projectName, mode: 'insensitive' },
    }
  }
  if (filters.milestoneIds?.length) {
    where.milestoneId = { in: filters.milestoneIds }
  }
  if (filters.statuses?.length) {
    where.status = { in: filters.statuses }
  }
  if (filters.priorities?.length) {
    where.priority = { in: filters.priorities }
  }
  if (filters.assigneeActorIds?.length && filters.unassigned) {
    where.OR = [
      { assigneeActorId: { in: filters.assigneeActorIds } },
      { assigneeActorId: null },
    ]
  } else if (filters.assigneeActorIds?.length) {
    where.assigneeActorId = { in: filters.assigneeActorIds }
  } else if (filters.unassigned) {
    where.assigneeActorId = null
  }
  if (filters.tagIds?.length) {
    where.taskTags = { some: { tagId: { in: filters.tagIds } } }
  }
  if (filters.sprintIds?.length) {
    where.sprintId = { in: filters.sprintIds }
  }
  // Each whitespace-separated term must appear (AND), in title or
  // description, case-insensitive substring — `oauth redirect` matches
  // "Fix OAuth callback redirect". A number term (`42` / `LUM-42`) also
  // matches the task number. Fuzzy mode (LUM-821) swaps this for the ranked
  // trigram query below.
  const terms = splitSearchTerms(filters.q)
  let rank: Map<string, number> | null = null
  if (terms.length && filters.fuzzy) {
    const matches = await taskRepository.rankTextMatches(workspaceId, terms)
    rank = new Map(matches.map(m => [m.id, m.score]))
    where.id = { in: matches.map(m => m.id) }
  } else if (terms.length) {
    where.AND = terms.map(term => {
      const textMatch: Prisma.TaskWhereInput[] = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ]
      const num = /^(?:[A-Za-z][A-Za-z0-9]*-)?(\d+)$/.exec(term)
      if (num) textMatch.push({ number: Number(num[1]) })
      return { OR: textMatch }
    })
  }
  if (filters.dueAfter || filters.dueBefore) {
    where.dueDate = {
      ...(filters.dueAfter ? { gte: filters.dueAfter } : {}),
      ...(filters.dueBefore ? { lt: filters.dueBefore } : {}),
    }
  }
  return { where, rank }
}
