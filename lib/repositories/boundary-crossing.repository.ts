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
        reversible: input.reversible,
        severity: input.severity,
      },
      select: SELECT,
    })
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
   * Disposition a crossing as a human actor (LUM-435). Idempotent on the
   * already-dispositioned row (updateMany guarded by disposition: null) so a
   * double click can't rewrite the original reviewer/disposition/timestamp.
   */
  async disposition(
    id: string,
    disposition: BoundaryCrossingDisposition,
    note: string | null,
    actorId: string | null,
    now: Date
  ) {
    return prisma.boundaryCrossing.updateMany({
      where: { id, disposition: null },
      data: {
        disposition,
        dispositionNote: note,
        dispositionedAt: now,
        dispositionedById: actorId,
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
