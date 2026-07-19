import {
  planRunRepository,
  type PlanRunRow,
  type PlanRunStageRecordRow,
  type PlanRunListRow,
  type PlanRunArchiveRow,
  type StageOutputData,
} from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { priorityRepository } from '@/lib/repositories/priority.repository'
import { getDefaultTeam } from '@/lib/team'
import {
  gateAt,
  isTerminalStage,
  retryableKind,
  SEGMENT_BY_KIND,
  TERMINAL_STAGES,
} from '@/lib/plan-run/state-machine'
import {
  assertEditPartitionsUniverse,
  collectClusterGateIds,
  type ClusterGateOutput,
} from '@/lib/plan-run/cluster-gate'
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
   * Load the gate-A (闸门A) board view: the run, the CLUSTER stage record's
   * current editable structure (the human-confirmed edit if one exists, else
   * the raw Stage-1 clustering), its optimistic-concurrency `revision`, and the
   * statements of the ideas it references so the board can render them.
   *
   * Workspace-scoped: a run in another workspace 404s (never leaks). Throws 404
   * if the run is missing or Stage-1 hasn't produced a CLUSTER record yet.
   */
  async getClusterGateView(args: {
    planRunId: string
    workspaceId: string
  }): Promise<{
    run: { id: string; stage: PlanRunRow['stage'] }
    board: ClusterGateOutput
    revision: number
    confirmedAt: Date | null
    ideas: { id: string; statement: string; sourceContext: string | null }[]
  }> {
    const run = await this.requireRun(args.planRunId)
    if (run.workspaceId !== args.workspaceId) {
      throw Object.assign(new Error(`Plan run ${run.id} not found`), {
        status: 404,
      })
    }

    const record = await planRunRepository.findStageRecord(run.id, 'CLUSTER')
    if (!record) {
      throw Object.assign(
        new Error(`Plan run ${run.id} has no clustering to review yet`),
        { status: 404 }
      )
    }

    const board = (record.humanConfirmedOutput ??
      record.llmRawOutput) as unknown as ClusterGateOutput

    const ideaRows = await ideaRepository.findByIds(
      collectClusterGateIds(board)
    )
    const ideas = ideaRows.map(i => ({
      id: i.id,
      statement: i.statement,
      sourceContext: i.sourceContext,
    }))

    return {
      run: { id: run.id, stage: run.stage },
      board,
      revision: record.revision,
      confirmedAt: record.confirmedAt,
      ideas,
    }
  },

  /**
   * Confirm gate A (闸门A): persist the reviewer's edited clustering (renamed
   * clusters + ideas moved between clusters/orphans) as the CLUSTER record's
   * `humanConfirmedOutput`, then advance the run CLUSTERS_READY → ALIGNING.
   *
   * Guards, in order:
   * - 409 if gate A is not open at the run's current stage (already confirmed /
   *   wrong stage).
   * - 409 if `ifRevision` is stale (a concurrent edit or a re-run bumped the
   *   record's `revision`) — the confirm is rejected rather than clobbering.
   * - 422 if the edit does not partition the original idea set exactly (a
   *   dropped/invented/duplicated id, or a blank cluster name).
   *
   * Advancing the stage is the trigger point for Stage-2 — the route schedules
   * the align run after this resolves. Throws 404 if the run is missing.
   */
  async confirmClusterGate(args: {
    planRunId: string
    workspaceId: string
    edited: ClusterGateOutput
    ifRevision: number
    confirmedBy: string
  }): Promise<PlanRunRow> {
    const run = await this.requireRun(args.planRunId)
    if (run.workspaceId !== args.workspaceId) {
      throw Object.assign(new Error(`Plan run ${run.id} not found`), {
        status: 404,
      })
    }

    const gate = gateAt(run.stage)
    if (!gate || gate.kind !== 'CLUSTER') {
      throw Object.assign(
        new Error(`Gate A is not open at stage ${run.stage}`),
        { status: 409 }
      )
    }

    const record = await planRunRepository.findStageRecord(run.id, 'CLUSTER')
    if (!record) {
      throw Object.assign(
        new Error(`Plan run ${run.id} has no clustering to confirm`),
        { status: 409 }
      )
    }

    if (args.ifRevision !== record.revision) {
      throw Object.assign(
        new Error(
          `Revision conflict: the clustering changed since you loaded it ` +
            `(current revision: ${record.revision}, your base: ${args.ifRevision}). ` +
            `Reload the board and re-apply your edits.`
        ),
        { status: 409 }
      )
    }

    const rawOutput = record.llmRawOutput as unknown as ClusterGateOutput
    const universe = new Set(collectClusterGateIds(rawOutput))
    assertEditPartitionsUniverse(universe, args.edited)

    await planRunRepository.confirmStageRecord(run.id, gate.kind, {
      humanConfirmedOutput: args.edited as unknown as Prisma.InputJsonValue,
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

  /**
   * The workspace default team's currently active run, or null. "Active" =
   * any non-terminal stage (FAILED counts as active — it is recoverable). A
   * read-only lookup: powers `lumo plan status` and the CLI's run-lock probe.
   * Throws 404 when the workspace has no default team.
   */
  async getActiveRun(args: {
    workspaceId: string
  }): Promise<PlanRunRow | null> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('No default team for workspace'), {
        status: 404,
      })
    }
    return planRunRepository.findActiveByTeam(team.id, [...TERMINAL_STAGES])
  },

  /**
   * Every plan run for the workspace's default team, newest first — the active
   * run plus terminal ones (MATERIALIZED / ABANDONED / FAILED). Powers the
   * Ideas-page plan-runs surface (LUM-677) so runs are reachable without the
   * CLI deep-link. Team-scoped: a caller only ever sees their own team's runs.
   * Throws 404 when the workspace has no default team.
   */
  async listRuns(args: { workspaceId: string }): Promise<PlanRunListRow[]> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('No default team for workspace'), {
        status: 404,
      })
    }
    return planRunRepository.listByTeam(team.id)
  },

  /**
   * A run's full read-only archive (LUM-677): the run + each gate's stage
   * record (llmRawOutput vs humanConfirmedOutput) + the materialized
   * Initiative(s). Workspace-scoped — a run in another workspace is reported as
   * 404 (not 403) so the endpoint never confirms a foreign run's existence.
   */
  async getArchive(args: {
    runId: string
    workspaceId: string
  }): Promise<PlanRunArchiveRow> {
    const run = await planRunRepository.findArchiveById(args.runId)
    if (!run || run.workspaceId !== args.workspaceId) {
      throw Object.assign(new Error(`Plan run ${args.runId} not found`), {
        status: 404,
      })
    }
    return run
  },

  /**
   * The clustering the Ideas page should group its pool by (LUM-677): the
   * CLUSTER output of the workspace default team's most recent run to reach
   * CLUSTERS_READY — the human-confirmed clustering if the gate was confirmed,
   * else the raw Stage-1 output. Returns null when no run has clustered yet
   * (the page then falls back to a flat list). A pure read of stored records —
   * **no clustering LLM call**. Throws 404 when there is no default team.
   */
  async getLatestClustering(args: { workspaceId: string }): Promise<{
    runId: string
    clusters: { name: string; ideaIds: string[] }[]
  } | null> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('No default team for workspace'), {
        status: 404,
      })
    }
    const record = await planRunRepository.findLatestClusterRecordByTeam(
      team.id
    )
    if (!record) return null
    return {
      runId: record.planRunId,
      clusters: extractClusterGroups(
        record.humanConfirmedOutput ?? record.llmRawOutput
      ),
    }
  },

  /** Load a run or throw 404. */
  /**
   * Re-arm a stuck run so its segment can be dispatched again (LUM-689).
   *
   * Resolves which segment to re-run (see `retryableKind`) and parks the run on
   * that segment's working stage, so the runner's `stage !== 'X' → no-op` guard
   * lets the retry through. Returns the kind for the caller to dispatch; the
   * caller fires the matching runner out of band.
   *
   * Deliberately does NOT clear the existing stage record: `upsertStageRecord`
   * overwrites it when the re-run succeeds, so a failed retry leaves the prior
   * output intact rather than destroying it.
   *
   * 404 if the run is missing / not in this workspace, 409 if the run is parked
   * at an open gate or in a terminal stage — neither is a segment to re-run.
   */
  async retryStage(args: {
    planRunId: string
    workspaceId: string
  }): Promise<{ run: PlanRunRow; kind: PlanStageKind }> {
    const run = await this.requireRun(args.planRunId)
    if (run.workspaceId !== args.workspaceId) {
      // Never leak the existence of another workspace's run.
      throw Object.assign(new Error(`Plan run ${args.planRunId} not found`), {
        status: 404,
      })
    }

    const records = await planRunRepository.findStageRecordSummaries(run.id)
    const kind = retryableKind({ stage: run.stage, records })
    if (!kind) {
      throw Object.assign(
        new Error(
          `Plan run ${run.id} is at ${run.stage} — there is no running step to retry`
        ),
        { status: 409 }
      )
    }

    const working = SEGMENT_BY_KIND[kind].working
    const rearmed =
      run.stage === working
        ? run
        : await planRunRepository.updateStage(run.id, working)
    return { run: rearmed, kind }
  },

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

/**
 * Pull `{ name, ideaIds }` clusters out of a stored CLUSTER output. The output
 * is opaque JSON (`ClusterGateOutput` shape when well-formed), so read
 * defensively: keep only clusters with a string `name` and a string[] of
 * `ideaIds`. Malformed / empty output yields `[]` (page falls back gracefully).
 */
function extractClusterGroups(
  output: unknown
): { name: string; ideaIds: string[] }[] {
  if (
    !output ||
    typeof output !== 'object' ||
    !Array.isArray((output as { clusters?: unknown }).clusters)
  ) {
    return []
  }
  return (output as { clusters: unknown[] }).clusters
    .map(c => {
      if (!c || typeof c !== 'object') return null
      const name = (c as { name?: unknown }).name
      const ideaIds = (c as { ideaIds?: unknown }).ideaIds
      if (typeof name !== 'string' || !Array.isArray(ideaIds)) return null
      return {
        name,
        ideaIds: ideaIds.filter((id): id is string => typeof id === 'string'),
      }
    })
    .filter((c): c is { name: string; ideaIds: string[] } => c !== null)
}

export type {
  PlanRunRow,
  PlanRunStageRecordRow,
  PlanRunListRow,
  PlanRunArchiveRow,
}
