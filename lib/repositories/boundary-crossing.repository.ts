import { prisma } from '@/lib/db/prisma'
import { EVASION_MARKER_MATCH } from '@/lib/boundary-crossing/evasion'
import {
  suppressionTargetFilter,
  type SuppressionTargetFilter,
} from '@/lib/boundary-crossing/suppression'
import type {
  BoundaryCrossingCategory,
  BoundaryCrossingDisposition,
  BoundaryCrossingSeverity,
  Prisma,
} from '@prisma/client'

export interface CreateBoundaryCrossingInput {
  /** Null since LUM-640 for milestone-scoped steward crossings (no task exists);
   *  every task-scoped detector still passes a string. */
  taskId: string | null
  /** LUM-640: the steward session's milestone for STEWARD_IMPLEMENTATION_ARTIFACT
   *  crossings. Null (omitted) on all task-scoped crossings. */
  milestoneId?: string | null
  hookEventId?: string | null
  /** LUM-511: the originating session for a CLI-sourced crossing (spinoff
   *  laundering) that has no hook event — the attribution read model resolves
   *  owner/agent/worktree/model from it when hookEventId is null. */
  sessionId?: string | null
  category: BoundaryCrossingCategory
  /** Human-readable detail: the matched command / path / pattern. */
  detail: string
  /** Coalescing target (LUM-477) — the edited file / normalized command this
   *  crossing is deduped on alongside (taskId, category). */
  target?: string | null
  /** Taxonomy-driven reversibility (LUM-435) — only npm installs are reversible. */
  reversible?: boolean
  /** Taxonomy-driven severity tier (LUM-442). */
  severity: BoundaryCrossingSeverity
  /** LUM-590: semantic / per-project advisory finding — surfaced in panel but
   *  never blocks the DONE gate. Defaults to false (non-advisory = blocking). */
  advisory?: boolean
  /** LUM-590: which compiled PolicyRule fired (text ref / id). */
  policyRuleRef?: string | null
  /** LUM-590: frozen verbatim text of the policy rule at detection time. */
  policyRuleText?: string | null
  /** LUM-478: a SYSTEM disposition stamped at creation time (AUTO_LEGIT only) —
   *  a deterministic high-confidence legit TEST_TAMPERING edit is recorded for
   *  audit but resolved out of the open queue with NO human actor. Omitted for an
   *  ordinary (open) crossing, which is created undispositioned. There is
   *  deliberately no `dispositionedById` here: a system auto-resolution has no
   *  human reviewer, and that null actor is exactly what distinguishes it from a
   *  human FALSE_POSITIVE on the audit trail. */
  disposition?: BoundaryCrossingDisposition | null
  dispositionNote?: string | null
  dispositionedAt?: Date | null
  /** LUM-751: the repository suppression rule that auto-dispositioned this
   *  crossing (disposition AUTO_SUPPRESSED). Like AUTO_LEGIT: a system
   *  decision, so still no `dispositionedById`. */
  suppressionRuleId?: string | null
}

/** LUM-542: input for an append-only agent self-explanation row. */
export interface CreateExplanationInput {
  crossingId: string
  note: string
  /** Originating Claude Code session (attribution); nullable for resilience. */
  authorSessionId?: string | null
  /** The session's agent type, as sent on the X-Lumo-Agent header; nullable. */
  authorAgent?: string | null
}

/** Projection for an explanation row (LUM-542). */
const EXPLANATION_SELECT = {
  id: true,
  crossingId: true,
  note: true,
  authorSessionId: true,
  authorAgent: true,
  createdAt: true,
} as const

/** Minimal projection for the system-explanation generate path (LUM-590). */
const EXPLAIN_SELECT = {
  id: true,
  taskId: true,
  category: true,
  severity: true,
  detail: true,
  policyRuleText: true,
  systemExplanation: true,
} as const

/** Lightweight projection for the gate / write paths. */
const SELECT = {
  id: true,
  taskId: true,
  category: true,
  detail: true,
  target: true,
  occurrenceCount: true,
  lastSeenAt: true,
  detectedAt: true,
  reversible: true,
  severity: true,
  disposition: true,
  dispositionNote: true,
  dispositionedAt: true,
  dispositionedById: true,
  remediationTaskId: true,
  // LUM-751: which suppression rule auto-dispositioned it (null otherwise).
  suppressionRuleId: true,
} as const

/**
 * Read-model projection (LUM-435). Joins the linked remediation task so the
 * acceptance bar can surface its live status without a second round-trip.
 */
const VIEW_SELECT = {
  ...SELECT,
  // The triggering hook event id — the read model joins it to surface the
  // inline edit-change for display-safe crossings (LUM-452).
  hookEventId: true,
  // LUM-511: the originating session for a hook-less (CLI-sourced) crossing —
  // the attribution read model falls back to it when hookEventId is null.
  sessionId: true,
  // LUM-590: advisory crossings surface in the panel but never block DONE.
  advisory: true,
  // LUM-590: which compiled PolicyRule fired (text ref / id).
  policyRuleRef: true,
  // LUM-590: frozen verbatim text of the policy rule at detection time.
  policyRuleText: true,
  // LUM-590: cached system-generated explanation (null = not yet generated).
  systemExplanation: true,
  // LUM-751: the rule behind an AUTO_SUPPRESSED disposition, for the panel's
  // "auto-dispositioned by rule" line + revoke affordance.
  suppressionRule: { select: { id: true, reason: true, revokedAt: true } },
  remediationTask: {
    select: {
      number: true,
      title: true,
      status: true,
      team: { select: { identifier: true } },
    },
  },
} as const

/**
 * Persistence for boundary-crossing markers (LUM-426/435). The marker mirrors
 * onto a TaskActivity for the timeline; this table holds the mutable
 * disposition state the DONE gate reads — TaskActivity is append-only and
 * cannot carry it.
 */
export const boundaryCrossingRepository = {
  async create(
    input: CreateBoundaryCrossingInput,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.boundaryCrossing.create({
      data: {
        taskId: input.taskId,
        milestoneId: input.milestoneId ?? null,
        hookEventId: input.hookEventId ?? null,
        sessionId: input.sessionId ?? null,
        category: input.category,
        detail: input.detail,
        target: input.target ?? null,
        reversible: input.reversible ?? false,
        severity: input.severity,
        // LUM-590: advisory crossings surface in the panel but never block DONE.
        advisory: input.advisory ?? false,
        policyRuleRef: input.policyRuleRef ?? null,
        policyRuleText: input.policyRuleText ?? null,
        // LUM-478: a system auto-resolution (AUTO_LEGIT) is stamped here with its
        // timestamp/note but NO dispositionedById — the null actor is the
        // audit-trail marker that this was a detector decision, not a human one.
        disposition: input.disposition ?? null,
        dispositionNote: input.dispositionNote ?? null,
        dispositionedAt: input.dispositionedAt ?? null,
        suppressionRuleId: input.suppressionRuleId ?? null,
      },
      select: SELECT,
    })
  },

  /**
   * LUM-751: coalesce a recurrence into the existing AUTO_SUPPRESSED row for the
   * same rule — the suppressed twin of `coalesceRecurrence` (which only merges
   * OPEN rows), so a rule-suppressed action recurring in a task bumps one row
   * instead of piling up audit rows.
   */
  async coalesceSuppressedRecurrence(
    taskId: string,
    category: BoundaryCrossingCategory,
    target: string | null,
    ruleId: string,
    now: Date
  ): Promise<number> {
    if (target == null) return 0
    const { count } = await prisma.boundaryCrossing.updateMany({
      where: {
        taskId,
        category,
        target,
        disposition: 'AUTO_SUPPRESSED',
        suppressionRuleId: ruleId,
      },
      data: { occurrenceCount: { increment: 1 }, lastSeenAt: now },
    })
    return count
  },

  /**
   * Coalesce a recurrence of an OPEN crossing (LUM-477). Atomically bump every
   * OPEN (undispositioned) crossing on the task whose (category, target) matches
   * — `occurrenceCount++` and `lastSeenAt = now` — and return how many rows were
   * touched. A return of 0 means there is no open match (a first occurrence, a
   * different target/category, or a prior matching crossing that was already
   * dispositioned) and the caller should insert a fresh row instead.
   *
   * `target == null` never coalesces: a null is "no coalescing key" (legacy
   * rows), so the WHERE never matches and the recurrence records anew.
   */
  async coalesceRecurrence(
    taskId: string,
    category: BoundaryCrossingCategory,
    target: string | null,
    now: Date
  ): Promise<number> {
    if (target == null) return 0
    const { count } = await prisma.boundaryCrossing.updateMany({
      where: { taskId, category, target, disposition: null },
      data: { occurrenceCount: { increment: 1 }, lastSeenAt: now },
    })
    return count
  },

  /**
   * LUM-640: the milestone-scoped twin of `coalesceRecurrence` for steward
   * crossings (which have no taskId) — same open-row (category, target)
   * semantics, keyed on milestoneId instead.
   */
  async coalesceRecurrenceForMilestone(
    milestoneId: string,
    category: BoundaryCrossingCategory,
    target: string | null,
    now: Date
  ): Promise<number> {
    if (target == null) return 0
    const { count } = await prisma.boundaryCrossing.updateMany({
      where: { milestoneId, category, target, disposition: null },
      data: { occurrenceCount: { increment: 1 }, lastSeenAt: now },
    })
    return count
  },

  /**
   * Task ids (within the candidate set) carrying ≥1 crossing of the given
   * category (or any of the categories) — LUM-511 folds the judge-confirmed
   * laundering crossings (CONTRACT_WEAKENING, SPINOFF_LAUNDERED, SILENT_FIX)
   * into the flywheel negative class (disposition-agnostic: a recorded one counts).
   */
  async taskIdsWithCategory(
    taskIds: string[],
    category: BoundaryCrossingCategory | BoundaryCrossingCategory[]
  ): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set()
    const rows = await prisma.boundaryCrossing.findMany({
      where: {
        taskId: { in: taskIds },
        category: Array.isArray(category) ? { in: category } : category,
      },
      select: { taskId: true },
      distinct: ['taskId'],
    })
    return new Set(
      rows.map(r => r.taskId).filter((id): id is string => id !== null)
    )
  },

  /**
   * Open (undispositioned) crossings on a task — what the DONE gate blocks on.
   * A crossing is open while `disposition` is null; either disposition clears it.
   */
  async findUndispositionedByTask(taskId: string) {
    return prisma.boundaryCrossing.findMany({
      where: { taskId, disposition: null, advisory: false }, // LUM-590: advisory never blocks
      select: SELECT,
      orderBy: { detectedAt: 'asc' },
    })
  },

  /**
   * Cheap existence check: does the task have ≥1 OPEN (undispositioned)
   * non-advisory crossing? Mirrors `findUndispositionedByTask`'s predicate
   * (taskId + disposition: null + advisory: false) but selects only a single id
   * — used by the SSR timeline-presence probe to decide whether the delivery tab
   * should default to the Acceptance sub-segment (LUM-520). Advisory crossings
   * are intentionally excluded: they do not block DONE and should not force the
   * UI into the Acceptance sub-segment.
   */
  async hasOpenForTask(taskId: string): Promise<boolean> {
    const row = await prisma.boundaryCrossing.findFirst({
      where: { taskId, disposition: null, advisory: false },
      select: { id: true },
    })
    return row !== null
  },

  /**
   * ALL crossings on a task including dispositioned ones (LUM-435 read model) —
   * dispositioned crossings (CONFIRMED especially) stay on record, never hidden.
   */
  async findAllByTask(taskId: string) {
    return prisma.boundaryCrossing.findMany({
      where: { taskId },
      select: VIEW_SELECT,
      orderBy: { detectedAt: 'asc' },
    })
  },

  async findById(id: string) {
    return prisma.boundaryCrossing.findUnique({ where: { id }, select: SELECT })
  },

  /**
   * Every human-dispositioned crossing, projected to just {category,
   * disposition} for the read-only false-positive-rate measurement (LUM-449).
   * A pure read — open (disposition: null) crossings are excluded because they
   * carry no human signal yet. Workspace-wide on purpose: the denoise signal is
   * per-category across all tasks, not per task.
   */
  async findDispositioned() {
    return prisma.boundaryCrossing.findMany({
      where: { disposition: { not: null } },
      select: { category: true, disposition: true },
      orderBy: { dispositionedAt: 'asc' },
    })
  },

  /**
   * Set (or clear) a crossing's disposition as a human actor (LUM-435/450).
   * Unconditional — re-disposition (LUM-450) overwrites the CURRENT state, so
   * the old `disposition: null` write guard is gone; idempotency (a no-op when
   * the value isn't actually changing) is owned by the service, which reads the
   * prior value to compute from->to and emit the append-only audit row.
   *
   * `disposition === null` reverts the crossing to OPEN: the whole disposition
   * tuple (note / timestamp / reviewer) is reset to null so an open row looks
   * exactly like a freshly-detected one — the gate keys on `disposition: null`,
   * and who/when/why the revert happened lives in the TaskActivity trail, not
   * on this mutable row.
   */
  async disposition(
    id: string,
    disposition: BoundaryCrossingDisposition | null,
    note: string | null,
    actorId: string | null,
    now: Date
  ) {
    return prisma.boundaryCrossing.updateMany({
      where: { id },
      data: {
        disposition,
        dispositionNote: disposition === null ? null : note,
        dispositionedAt: disposition === null ? null : now,
        dispositionedById: disposition === null ? null : actorId,
      },
    })
  },

  /**
   * LUM-759 — the WHERE that selects the crossings a repository suppression
   * rule reaches backwards to. Deliberately narrow, and the ONLY place the
   * blast radius is defined (both the read-only preview count and the sweep
   * itself go through it, so the number a human is shown is the number that
   * gets stamped):
   *
   *  - the crossing is still OPEN (`disposition: null`) — a human ruling, an
   *    AUTO_LEGIT and an earlier AUTO_SUPPRESSED are all already decided and
   *    are never rewritten by a later rule;
   *  - it sits in this project, on a task or (LUM-640) a milestone of it;
   *  - same category, and its coalescing `target` matches the rule's exact or
   *    `prefix*` pattern — a null target never matches, same as the detector;
   *  - it is not evasion-decoded: deliberate obfuscation is never a false
   *    positive, so no rule may auto-handle it (the detector's own red line).
   *
   * The non-suppressible HIGH classes are refused when the rule is created, so
   * a rule that reaches here can never carry one.
   */
  retroactiveSuppressionWhere(input: {
    projectId: string
    category: BoundaryCrossingCategory
    targetPattern: string
    /** The crossing the rule is being built FROM — the human is ruling on it
     *  directly, so it is never part of the "other existing alerts" the sweep
     *  touches or the preview counts. */
    excludeCrossingId?: string | null
  }): Prisma.BoundaryCrossingWhereInput {
    const filter: SuppressionTargetFilter = suppressionTargetFilter(
      input.targetPattern
    )
    return {
      disposition: null,
      category: input.category,
      target:
        filter.kind === 'exact' ? filter.value : { startsWith: filter.value },
      // A LIST, not one object: `NOT: { a, b }` would negate the CONJUNCTION
      // (excluding only rows that are both the source crossing AND
      // evasion-decoded). The list form requires every clause to fail, which
      // is the intended "neither of these".
      NOT: [
        ...(input.excludeCrossingId ? [{ id: input.excludeCrossingId }] : []),
        { detail: { contains: EVASION_MARKER_MATCH } },
      ],
      OR: [
        { task: { projectId: input.projectId } },
        { milestone: { projectId: input.projectId } },
      ],
    }
  },

  /** LUM-759: how many existing crossings a prospective rule would dispose —
   *  the read-only preview behind the panel's confirmation line. */
  async countRetroactiveSuppressionCandidates(input: {
    projectId: string
    category: BoundaryCrossingCategory
    targetPattern: string
    excludeCrossingId?: string | null
  }): Promise<number> {
    return prisma.boundaryCrossing.count({
      where: this.retroactiveSuppressionWhere(input),
    })
  },

  /**
   * LUM-759: the candidates a rule creation will stamp, most recently detected
   * first and capped at `limit`. Returns `taskId` so the caller can append the
   * per-crossing audit activity, and `category`/`detail` for its payload.
   */
  async findRetroactiveSuppressionCandidates(
    input: {
      projectId: string
      category: BoundaryCrossingCategory
      targetPattern: string
      excludeCrossingId?: string | null
      limit: number
    },
    tx?: Prisma.TransactionClient
  ): Promise<
    Array<{
      id: string
      taskId: string | null
      category: BoundaryCrossingCategory
      detail: string
    }>
  > {
    const client = tx ?? prisma
    return client.boundaryCrossing.findMany({
      where: this.retroactiveSuppressionWhere(input),
      select: { id: true, taskId: true, category: true, detail: true },
      orderBy: { detectedAt: 'desc' },
      take: input.limit,
    })
  },

  /**
   * LUM-759: stamp the swept crossings isomorphically to a fresh suppressed
   * detection — AUTO_SUPPRESSED + the rule ref + the same note, and NO
   * `dispositionedById`: a rule application has no human reviewer, and that
   * null actor is exactly what tells an auditor "system", not "someone ruled".
   */
  async suppressManyByIds(
    ids: string[],
    ruleId: string,
    note: string,
    now: Date,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    if (ids.length === 0) return 0
    const client = tx ?? prisma
    const { count } = await client.boundaryCrossing.updateMany({
      where: { id: { in: ids } },
      data: {
        disposition: 'AUTO_SUPPRESSED',
        dispositionNote: note,
        dispositionedAt: now,
        dispositionedById: null,
        suppressionRuleId: ruleId,
      },
    })
    return count
  },

  /**
   * LUM-759: the crossings a revoke has to put back — everything still
   * carrying this rule's AUTO_SUPPRESSED stamp. A row a human has since
   * re-dispositioned no longer has that stamp and is therefore left alone.
   */
  async findSuppressedByRule(
    ruleId: string,
    tx?: Prisma.TransactionClient
  ): Promise<
    Array<{
      id: string
      taskId: string | null
      category: BoundaryCrossingCategory
      detail: string
    }>
  > {
    const client = tx ?? prisma
    return client.boundaryCrossing.findMany({
      where: { suppressionRuleId: ruleId, disposition: 'AUTO_SUPPRESSED' },
      select: { id: true, taskId: true, category: true, detail: true },
    })
  },

  /**
   * LUM-759: restore rule-suppressed crossings to a CLEAN open row — the
   * inverse of {@link suppressManyByIds}. The rule ref is cleared with the
   * disposition so the row is indistinguishable from one that was never
   * suppressed (the detector's OPEN coalescing keys on `disposition: null`,
   * the suppressed coalescing on the rule id — leaving a dangling ref would
   * strand it between the two). Which rule had suppressed it survives in the
   * append-only activity the service writes alongside.
   */
  async reopenManyByIds(
    ids: string[],
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    if (ids.length === 0) return 0
    const client = tx ?? prisma
    const { count } = await client.boundaryCrossing.updateMany({
      where: { id: { in: ids } },
      data: {
        disposition: null,
        dispositionNote: null,
        dispositionedAt: null,
        dispositionedById: null,
        suppressionRuleId: null,
      },
    })
    return count
  },

  /** Link a remediation follow-up task to a crossing (LUM-435). */
  async setRemediationTask(id: string, remediationTaskId: string) {
    return prisma.boundaryCrossing.update({
      where: { id },
      data: { remediationTaskId },
      select: SELECT,
    })
  },

  /** Whether the default-on DONE gate is enabled for the workspace (LUM-426). */
  async isGateEnabledForWorkspace(workspaceId: string): Promise<boolean> {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { boundaryGateEnabled: true },
    })
    // Absent workspace → treat as enabled (fail safe: the gate stays on).
    return ws?.boundaryGateEnabled ?? true
  },

  // ─── LUM-542: append-only agent self-explanations ("申辩") ──────────────────
  // This layer is purely additive. None of these methods read or write
  // `disposition`, and there is deliberately NO update/delete on an explanation
  // row — a correction is a new insert, so earlier wording always survives.

  /** Insert one append-only explanation. Insert-only by design. */
  async createExplanation(input: CreateExplanationInput) {
    return prisma.boundaryCrossingExplanation.create({
      data: {
        crossingId: input.crossingId,
        note: input.note,
        authorSessionId: input.authorSessionId ?? null,
        authorAgent: input.authorAgent ?? null,
      },
      select: EXPLANATION_SELECT,
    })
  },

  /** All explanations for a set of crossings, oldest-first (append order). The
   *  web read model groups these per crossing in memory. */
  async listExplanationsByCrossingIds(crossingIds: string[]) {
    if (crossingIds.length === 0) return []
    return prisma.boundaryCrossingExplanation.findMany({
      where: { crossingId: { in: crossingIds } },
      select: EXPLANATION_SELECT,
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * Open (undispositioned) crossings on a task the agent has NOT yet been
   * reminded about (LUM-542). Drives the one-time hook reminder: only OPEN
   * crossings are worth explaining, and `agentNotifiedAt: null` guarantees each
   * is surfaced exactly once. Minimal projection — the reminder only needs the
   * id/category/severity.
   */
  async findUnnotifiedOpenByTask(taskId: string) {
    return prisma.boundaryCrossing.findMany({
      where: { taskId, disposition: null, agentNotifiedAt: null },
      select: { id: true, category: true, severity: true },
      orderBy: { detectedAt: 'asc' },
    })
  },

  /**
   * Stamp `agentNotifiedAt` on crossings that haven't been reminded yet
   * (LUM-542). Guarded by `agentNotifiedAt: null` so it is idempotent — a second
   * call touches nothing and the reminder never re-fires. Returns how many rows
   * were freshly stamped.
   */
  async markAgentNotified(crossingIds: string[], now: Date): Promise<number> {
    if (crossingIds.length === 0) return 0
    const { count } = await prisma.boundaryCrossing.updateMany({
      where: { id: { in: crossingIds }, agentNotifiedAt: null },
      data: { agentNotifiedAt: now },
    })
    return count
  },

  // ─── LUM-590: lazy system-generated explanation ──────────────────────────────

  /**
   * Load the fields the LLM explanation generator needs: category, severity,
   * detail, policyRuleText, and the cached systemExplanation (null = not yet
   * generated). Returns null when the crossing is not found.
   */
  async findForExplanation(id: string) {
    return prisma.boundaryCrossing.findUnique({
      where: { id },
      select: EXPLAIN_SELECT,
    })
  },

  /**
   * Persist the LLM-generated system explanation on the crossing (LUM-590).
   * Called exactly once per crossing — subsequent reads hit the cache in the
   * service and never reach this updater again. Write-once by convention (the
   * service's cache-hit path short-circuits before calling this).
   */
  async setSystemExplanation(id: string, text: string) {
    return prisma.boundaryCrossing.update({
      where: { id },
      data: { systemExplanation: text },
      select: { id: true, systemExplanation: true },
    })
  },

  /** LUM-638 — raw severity/disposition rows; OPEN filtering happens in the pure fn. */
  async findSeverityRowsByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) return []
    const rows = await prisma.boundaryCrossing.findMany({
      where: { taskId: { in: taskIds } },
      select: {
        taskId: true,
        severity: true,
        disposition: true,
        advisory: true,
      },
    })
    // The WHERE pins taskId to the in-list, so it is never null at runtime —
    // but the column is nullable since LUM-640 (milestone-scoped steward
    // crossings), so narrow the Prisma type back to string.
    return rows.filter(
      (r): r is (typeof rows)[number] & { taskId: string } => r.taskId !== null
    )
  },
}
