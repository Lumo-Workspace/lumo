import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'
import type { PlanRunStage, PlanStageKind } from '@prisma/client'

/**
 * PlanRun repository (LUM-663 schema, LUM-664 state-machine service). Wraps
 * Prisma for the 转换器 run and its per-gate stage records; holds no business
 * logic — the run lock, transition matrix and snapshot freezing all live in
 * the service. Stage records are keyed by the `@@unique([planRunId, kind])`
 * constraint so a retry overwrites in place rather than duplicating.
 */

const RUN_SELECT = {
  id: true,
  teamId: true,
  workspaceId: true,
  stage: true,
  startedByMemberId: true,
  inputIdeaIds: true,
  priorityId: true,
  prioritySnapshot: true,
  proseDocument: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanRunSelect

const STAGE_RECORD_SELECT = {
  id: true,
  planRunId: true,
  kind: true,
  model: true,
  promptTokens: true,
  outputTokens: true,
  llmInput: true,
  llmRawOutput: true,
  humanConfirmedOutput: true,
  confirmedBy: true,
  confirmedAt: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanRunStageRecordSelect

// A lightweight row for the plan-runs list surface (LUM-677): enough to render
// one line per run + its materialized Initiative(s) for lineage, without the
// heavy frozen-snapshot / prose columns.
const LIST_SELECT = {
  id: true,
  stage: true,
  createdAt: true,
  updatedAt: true,
  initiatives: {
    select: { id: true, number: true, name: true },
  },
} satisfies Prisma.PlanRunSelect

// The read-only archive of a whole run (LUM-677): the run + every gate's
// stage record (llmRawOutput vs humanConfirmedOutput = the "全量存档") + the
// materialized Initiative(s) for lineage. `workspaceId` is carried so the
// service can enforce workspace scoping before returning.
const ARCHIVE_SELECT = {
  id: true,
  workspaceId: true,
  stage: true,
  startedByMemberId: true,
  prioritySnapshot: true,
  createdAt: true,
  updatedAt: true,
  stageRecords: {
    select: {
      kind: true,
      model: true,
      llmRawOutput: true,
      humanConfirmedOutput: true,
      confirmedBy: true,
      confirmedAt: true,
      revision: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  initiatives: {
    select: { id: true, number: true, name: true },
  },
} satisfies Prisma.PlanRunSelect

export type PlanRunRow = Prisma.PlanRunGetPayload<{ select: typeof RUN_SELECT }>
export type PlanRunStageRecordRow = Prisma.PlanRunStageRecordGetPayload<{
  select: typeof STAGE_RECORD_SELECT
}>
export type PlanRunListRow = Prisma.PlanRunGetPayload<{
  select: typeof LIST_SELECT
}>
export type PlanRunArchiveRow = Prisma.PlanRunGetPayload<{
  select: typeof ARCHIVE_SELECT
}>

export interface CreatePlanRunData {
  teamId: string
  workspaceId: string
  startedByMemberId: string
  inputIdeaIds: string[]
  priorityId: string | null
  prioritySnapshot: string | null
}

export interface StageOutputData {
  model: string
  promptTokens: number
  outputTokens: number
  llmInput: string
  llmRawOutput: Prisma.InputJsonValue
}

export const planRunRepository = {
  /**
   * The team's currently active run, or null. "Active" = any stage that is not
   * terminal (MATERIALIZED / ABANDONED). FAILED counts as active (it is
   * recoverable). Newest first so a caller sees the most recent contender.
   */
  async findActiveByTeam(
    teamId: string,
    terminalStages: PlanRunStage[]
  ): Promise<PlanRunRow | null> {
    return prisma.planRun.findFirst({
      where: { teamId, stage: { notIn: terminalStages } },
      select: RUN_SELECT,
      orderBy: { createdAt: 'desc' },
    })
  },

  async findById(id: string): Promise<PlanRunRow | null> {
    return prisma.planRun.findUnique({ where: { id }, select: RUN_SELECT })
  },

  /**
   * Every run for a team, newest first — the active run plus terminal ones
   * (MATERIALIZED / ABANDONED / FAILED). Team-scoped so one team's runs never
   * leak into another's list (LUM-677). Light `LIST_SELECT` for the list surface.
   */
  async listByTeam(teamId: string): Promise<PlanRunListRow[]> {
    return prisma.planRun.findMany({
      where: { teamId },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    })
  },

  /**
   * A run's full read-only archive by id (run + all gate stage records +
   * materialized initiatives), or null. The service enforces workspace scoping
   * on the returned `workspaceId` before handing it out (LUM-677).
   */
  async findArchiveById(id: string): Promise<PlanRunArchiveRow | null> {
    return prisma.planRun.findUnique({ where: { id }, select: ARCHIVE_SELECT })
  },

  /**
   * The CLUSTER stage record of the team's most recent run to have reached
   * CLUSTERS_READY (i.e. that produced a clustering), or null. Ordered by the
   * parent run's `createdAt` so the newest clustering wins. Carries both the
   * raw Stage-1 output and the human-confirmed edit so the caller can prefer
   * the confirmed clustering. Powers the Ideas-page grouped view (LUM-677) —
   * a pure DB read, no clustering LLM call.
   */
  async findLatestClusterRecordByTeam(teamId: string): Promise<{
    planRunId: string
    llmRawOutput: PlanRunStageRecordRow['llmRawOutput']
    humanConfirmedOutput: PlanRunStageRecordRow['humanConfirmedOutput']
  } | null> {
    return prisma.planRunStageRecord.findFirst({
      where: { kind: 'CLUSTER', planRun: { teamId } },
      orderBy: { planRun: { createdAt: 'desc' } },
      select: {
        planRunId: true,
        llmRawOutput: true,
        humanConfirmedOutput: true,
      },
    })
  },

  /** One stage record by (run, kind), or null. Used by the web gate to read the
   *  pre-gate output + its optimistic-concurrency `revision`. */
  async findStageRecord(
    planRunId: string,
    kind: PlanStageKind
  ): Promise<PlanRunStageRecordRow | null> {
    return prisma.planRunStageRecord.findUnique({
      where: { planRunId_kind: { planRunId, kind } },
      select: STAGE_RECORD_SELECT,
    })
  },

  /** Which segments a run has already produced, and whether each was
   *  gate-confirmed. Enough to recover the segment a FAILED run stopped in
   *  (LUM-689) without loading the stage payloads. */
  async findStageRecordSummaries(
    planRunId: string
  ): Promise<Array<{ kind: PlanStageKind; confirmed: boolean }>> {
    const rows = await prisma.planRunStageRecord.findMany({
      where: { planRunId },
      select: { kind: true, confirmedAt: true },
    })
    return rows.map(r => ({ kind: r.kind, confirmed: r.confirmedAt !== null }))
  },

  /** Create a run in the initial CLUSTERING stage with a frozen input snapshot. */
  async create(data: CreatePlanRunData): Promise<PlanRunRow> {
    return prisma.planRun.create({
      data: { ...data, stage: 'CLUSTERING' },
      select: RUN_SELECT,
    })
  },

  async updateStage(id: string, stage: PlanRunStage): Promise<PlanRunRow> {
    return prisma.planRun.update({
      where: { id },
      data: { stage },
      select: RUN_SELECT,
    })
  },

  /**
   * Record a stage's LLM output, upserting on `(planRunId, kind)` so a retry
   * of a FAILED stage overwrites the existing record rather than creating a
   * duplicate. The upsert clears any prior human confirmation on overwrite —
   * a re-run invalidates the earlier gate decision.
   */
  async upsertStageRecord(
    planRunId: string,
    kind: PlanStageKind,
    data: StageOutputData
  ): Promise<PlanRunStageRecordRow> {
    return prisma.planRunStageRecord.upsert({
      where: { planRunId_kind: { planRunId, kind } },
      create: { planRunId, kind, ...data },
      update: {
        ...data,
        humanConfirmedOutput: Prisma.DbNull,
        confirmedBy: null,
        confirmedAt: null,
        // A re-run invalidates any board a reviewer already loaded, so bump the
        // optimistic-concurrency token: their stale confirm will now 409.
        revision: { increment: 1 },
      },
      select: STAGE_RECORD_SELECT,
    })
  },

  /** Persist the human-confirmed output for a gate onto its stage record and
   *  bump its optimistic-concurrency `revision`. */
  async confirmStageRecord(
    planRunId: string,
    kind: PlanStageKind,
    data: {
      humanConfirmedOutput: Prisma.InputJsonValue
      confirmedBy: string
      confirmedAt: Date
    }
  ): Promise<PlanRunStageRecordRow> {
    return prisma.planRunStageRecord.update({
      where: { planRunId_kind: { planRunId, kind } },
      data: { ...data, revision: { increment: 1 } },
      select: STAGE_RECORD_SELECT,
    })
  },
}
