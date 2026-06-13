import { prisma } from '@/lib/db/prisma'
import type {
  BoundaryCrossingCategory,
  BoundaryCrossingDisposition,
  BoundaryCrossingSeverity,
  Prisma,
} from '@prisma/client'

export interface CreateBoundaryCrossingInput {
  taskId: string
  hookEventId?: string | null
  category: BoundaryCrossingCategory
  /** Human-readable detail: the matched command / path / pattern. */
  detail: string
  /** Coalescing target (LUM-477) — the edited file / normalized command this
   *  crossing is deduped on alongside (taskId, category). */
  target?: string | null
  /** Taxonomy-driven reversibility (LUM-435) — only npm installs are reversible. */
  reversible: boolean
  /** Taxonomy-driven severity tier (LUM-442). */
  severity: BoundaryCrossingSeverity
}

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
        hookEventId: input.hookEventId ?? null,
        category: input.category,
        detail: input.detail,
        target: input.target ?? null,
        reversible: input.reversible,
        severity: input.severity,
      },
      select: SELECT,
    })
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
   * Open (undispositioned) crossings on a task — what the DONE gate blocks on.
   * A crossing is open while `disposition` is null; either disposition clears it.
   */
  async findUndispositionedByTask(taskId: string) {
    return prisma.boundaryCrossing.findMany({
      where: { taskId, disposition: null },
      select: SELECT,
      orderBy: { detectedAt: 'asc' },
    })
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
}
