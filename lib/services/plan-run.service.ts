import {
  planRunRepository,
  type PlanRunRow,
  type PlanRunStageRecordRow,
  type StageOutputData,
} from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { priorityRepository } from '@/lib/repositories/priority.repository'
import { getDefaultTeam } from '@/lib/team'
import {
  gateAt,
  isTerminalStage,
  SEGMENT_BY_KIND,
  TERMINAL_STAGES,
} from '@/lib/plan-run/state-machine'
import type { Prisma, PlanStageKind } from '@prisma/client'

/**
 * PlanRun state-machine service (LUM-664, Spec2-2). Orchestrates the
 * design-thinking 转换器: freezes the input snapshot at start, enforces one
 * active run per team, walks the 3-gate transition matrix, and lets a FAILED
 * stage be retried. Never touches Prisma directly (goes through repositories)
 * and never handles HTTP — errors carry a `{ status }` for the route layer.
 */
export const planRunService = {
  /**
   * Start a run for the workspace's default team. Freezes the input snapshot —
   * `inputIdeaIds` = the team's current CAPTURED idea ids, `prioritySnapshot` =
   * the current Priority text — and creates the run in CLUSTERING.
   *
   * Run lock: at most one active run per team (active = stage ∉ terminal). If
   * one exists, refuse with 409 unless `abandonActive`, which first flips the
   * prior run to ABANDONED and then creates the new one.
   *
   * Throws 404 when the workspace has no default team, 409 on the run lock.
   */
  async startRun(args: {
    workspaceId: string
    memberId: string
    abandonActive?: boolean
  }): Promise<PlanRunRow> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('No default team for workspace'), {
        status: 404,
      })
    }

    const active = await planRunRepository.findActiveByTeam(team.id, [
      ...TERMINAL_STAGES,
    ])
    if (active) {
      if (!args.abandonActive) {
        throw Object.assign(
          new Error(
            `An active plan run (${active.id}) already exists for this team; ` +
              `abandon it first or pass abandonActive`
          ),
          { status: 409 }
        )
      }
      await planRunRepository.updateStage(active.id, 'ABANDONED')
    }

    const capturedIdeas = await ideaRepository.listCapturedByTeam(team.id)
    const currentPriority = await priorityRepository.findCurrent(team.id)

    return planRunRepository.create({
      teamId: team.id,
      workspaceId: args.workspaceId,
      startedByMemberId: args.memberId,
      inputIdeaIds: capturedIdeas.map(idea => idea.id),
      priorityId: currentPriority?.id ?? null,
      prioritySnapshot: currentPriority?.statement ?? null,
    })
  },

  /**
   * Record a stage's LLM output and advance the run to that stage's `*_READY`
   * gate. Upserts the stage record on `(planRunId, kind)`, so retrying a FAILED
   * stage overwrites its record rather than duplicating it. Throws 404 if the
   * run is missing.
   */
  async recordStageOutput(args: {
    planRunId: string
    kind: PlanStageKind
    output: StageOutputData
  }): Promise<PlanRunRow> {
    const run = await this.requireRun(args.planRunId)
    await planRunRepository.upsertStageRecord(run.id, args.kind, args.output)
    return planRunRepository.updateStage(
      run.id,
      SEGMENT_BY_KIND[args.kind].ready
    )
  },

  /**
   * Confirm the gate open at the run's current stage: persist the
   * human-confirmed output onto that kind's stage record and advance the run
   * to the next stage. Rejects an illegal transition (no gate at the current
   * stage) with 409. Throws 404 if the run is missing.
   */
  async confirmGate(args: {
    planRunId: string
    humanConfirmedOutput: Prisma.InputJsonValue
    confirmedBy: string
  }): Promise<PlanRunRow> {
    const run = await this.requireRun(args.planRunId)
    const gate = gateAt(run.stage)
    if (!gate) {
      throw Object.assign(
        new Error(
          `No gate open at stage ${run.stage}; cannot confirm a plan-run gate here`
        ),
        { status: 409 }
      )
    }

    await planRunRepository.confirmStageRecord(run.id, gate.kind, {
      humanConfirmedOutput: args.humanConfirmedOutput,
      confirmedBy: args.confirmedBy,
      confirmedAt: new Date(),
    })
    return planRunRepository.updateStage(run.id, gate.next)
  },

  /**
   * Mark a run's current segment as FAILED (an LLM stage errored). The run
   * stays active — `recordStageOutput` with the same kind retries it. Throws
   * 404 if the run is missing.
   */
  async failStage(planRunId: string): Promise<PlanRunRow> {
    const run = await this.requireRun(planRunId)
    return planRunRepository.updateStage(run.id, 'FAILED')
  },

  /**
   * Abandon a run. The frozen ideas were never mutated, so they naturally fall
   * back into the next run's input pool. Terminal — a new run can start.
   * Throws 404 if the run is missing, 409 if the run is already terminal.
   */
  async abandon(planRunId: string): Promise<PlanRunRow> {
    const run = await this.requireRun(planRunId)
    if (isTerminalStage(run.stage)) {
      throw Object.assign(
        new Error(`Plan run ${run.id} is already ${run.stage}`),
        { status: 409 }
      )
    }
    return planRunRepository.updateStage(run.id, 'ABANDONED')
  },

  /** Load a run or throw 404. */
  async requireRun(planRunId: string): Promise<PlanRunRow> {
    const run = await planRunRepository.findById(planRunId)
    if (!run) {
      throw Object.assign(new Error(`Plan run ${planRunId} not found`), {
        status: 404,
      })
    }
    return run
  },
}

export type { PlanRunRow, PlanRunStageRecordRow }
