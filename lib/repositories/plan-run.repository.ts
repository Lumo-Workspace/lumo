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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanRunStageRecordSelect

export type PlanRunRow = Prisma.PlanRunGetPayload<{ select: typeof RUN_SELECT }>
export type PlanRunStageRecordRow = Prisma.PlanRunStageRecordGetPayload<{
  select: typeof STAGE_RECORD_SELECT
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
      },
      select: STAGE_RECORD_SELECT,
    })
  },

  /** Persist the human-confirmed output for a gate onto its stage record. */
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
      data,
      select: STAGE_RECORD_SELECT,
    })
  },
}
