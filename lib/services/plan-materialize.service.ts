import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import {
  planMaterializeRepository,
  type MaterializeResult,
} from '@/lib/repositories/plan-materialize.repository'
import type { MaterializePlanInput } from '@/lib/validation/plan-run'
import type {
  PlanGenerateOutput,
  ClusterPlanDraft,
} from '@/lib/llm/plan-generate-client'
import type { SizeHint } from '@prisma/client'

/** One project option for the Gate-C picker. */
export interface GateProjectOption {
  id: string
  name: string
}

/** A draft as rendered at Gate C — the Stage-3 draft plus the ids of the ideas
 *  its cluster consumed (resolved best-effort for the materialisation lineage). */
export interface GateDraft extends ClusterPlanDraft {
  ideaIds: string[]
}

/** Everything Gate C needs to render (design §4 row C). */
export interface GateCData {
  runId: string
  stage: string
  /** Editable prose (run.proseDocument once edited, else the Stage-3 prose). */
  prose: string
  drafts: GateDraft[]
  projects: GateProjectOption[]
  /** The sole non-idea project, pre-selected in the picker (D4); else null. */
  defaultProjectId: string | null
}

/** Read a clusterId→ideaIds map from the ALIGN stage record's gate-B
 *  confirmation, best-effort.
 *
 *  The source is deliberately gate B, not gate A: a confirmed *clustering*
 *  (`ClusterGateCluster`) is `{name, thrust, ideaIds}` and carries no
 *  `clusterId` at all — cluster identity there is positional. Reading it here
 *  therefore matched nothing and left every draft with an empty idea list, so
 *  materialisation consumed no ideas and none ever reached PLANNED (LUM-689).
 *  Gate B's `humanConfirmedOutput.clusters[]` carries both the `clusterId` the
 *  drafts are keyed by and the ideas the reviewer actually kept for this plan
 *  (the per-idea 取舍, LUM-688) — which is exactly what a draft consumes.
 *
 *  Still best-effort: an unreadable record renders a draft with no linked
 *  ideas rather than failing the gate. */
function clusterIdeaMap(raw: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const clusters =
    raw && typeof raw === 'object' && 'clusters' in raw
      ? (raw as { clusters?: unknown }).clusters
      : undefined
  if (!Array.isArray(clusters)) return map
  for (const c of clusters) {
    if (c && typeof c === 'object') {
      const { clusterId, ideaIds } = c as {
        clusterId?: unknown
        ideaIds?: unknown
      }
      if (typeof clusterId === 'string' && Array.isArray(ideaIds)) {
        map.set(
          clusterId,
          ideaIds.filter((x): x is string => typeof x === 'string')
        )
      }
    }
  }
  return map
}

/**
 * Gate-C materialisation service (LUM-671, Spec2-9). Orchestrates accepting a
 * DRAFT_READY plan run: it validates the confirmed payload (project scope, idea
 * provenance, at least one kept task), builds the write plan, and hands the
 * whole multi-model write to `planMaterializeRepository` as a single atomic
 * transaction. Never touches Prisma directly and never handles HTTP — errors
 * carry a `{ status }` for the route layer (design §5 / §9).
 */

const SIZE_TO_HINT: Record<'S' | 'M' | 'L', SizeHint> = {
  S: 'S',
  M: 'M',
  L: 'L',
}

export const planMaterializeService = {
  /**
   * Thin run read for the deep-link gate dispatcher: which gate to render is
   * decided by `stage`. Scoped to the caller's workspace (404 otherwise —
   * never leak another workspace's run).
   */
  async getRunView(args: {
    planRunId: string
    workspaceId: string
  }): Promise<{ id: string; stage: string }> {
    const run = await planRunRepository.findById(args.planRunId)
    if (!run || run.workspaceId !== args.workspaceId) {
      throw Object.assign(new Error(`Plan run ${args.planRunId} not found`), {
        status: 404,
      })
    }
    return { id: run.id, stage: run.stage }
  },

  /**
   * Assemble everything Gate C renders for a DRAFT_READY run: the prose, the
   * drafts (each with its consumed idea ids), and the workspace's projects with
   * the sole-project default (D4). Throws 404 if the run is missing / in another
   * workspace, 409 if it is not at DRAFT_READY, 422 if the GENERATE draft is
   * missing (the run never produced a plan).
   */
  async getGateData(args: {
    planRunId: string
    workspaceId: string
  }): Promise<GateCData> {
    const run = await planRunRepository.findById(args.planRunId)
    if (!run || run.workspaceId !== args.workspaceId) {
      throw Object.assign(new Error(`Plan run ${args.planRunId} not found`), {
        status: 404,
      })
    }
    if (run.stage !== 'DRAFT_READY') {
      throw Object.assign(
        new Error(
          `Plan run ${run.id} is at ${run.stage}; Gate C opens only at DRAFT_READY`
        ),
        { status: 409 }
      )
    }

    const generate = await planRunRepository.findStageRecord(run.id, 'GENERATE')
    if (!generate) {
      throw Object.assign(
        new Error(`Plan run ${run.id} has no generated draft`),
        { status: 422 }
      )
    }
    const output = generate.llmRawOutput as unknown as PlanGenerateOutput

    const align = await planRunRepository.findStageRecord(run.id, 'ALIGN')
    const ideaMap = clusterIdeaMap(align?.humanConfirmedOutput)

    const drafts: GateDraft[] = (output.drafts ?? []).map(d => ({
      ...d,
      ideaIds: ideaMap.get(d.clusterId) ?? [],
    }))

    const projects = await projectRepository.findByWorkspaceNonIdea(
      run.workspaceId
    )
    const options: GateProjectOption[] = projects.map(p => ({
      id: p.id,
      name: p.name,
    }))

    return {
      runId: run.id,
      stage: run.stage,
      prose: run.proseDocument ?? output.prose ?? '',
      drafts,
      projects: options,
      defaultProjectId: options.length === 1 ? options[0]!.id : null,
    }
  },

  /**
   * Materialise a Gate-C-confirmed plan. Preconditions, each fail-closed:
   * - the run exists (404) and belongs to the caller's workspace (404 — never
   *   leak another workspace's run),
   * - the run is at DRAFT_READY (409 — nothing else can be materialised),
   * - the chosen project exists in the same workspace (400),
   * - every referenced idea is one the run actually froze in (400),
   * - at least one task across all drafts is kept (400).
   *
   * Struck (unchecked) tasks are dropped here; a draft left with zero kept
   * tasks is not materialised into an Initiative (design §5).
   */
  async materialize(args: {
    planRunId: string
    workspaceId: string
    memberId: string
    input: MaterializePlanInput
  }): Promise<MaterializeResult> {
    const run = await planRunRepository.findById(args.planRunId)
    if (!run || run.workspaceId !== args.workspaceId) {
      throw Object.assign(new Error(`Plan run ${args.planRunId} not found`), {
        status: 404,
      })
    }

    if (run.stage !== 'DRAFT_READY') {
      throw Object.assign(
        new Error(
          `Plan run ${run.id} is at ${run.stage}; only a DRAFT_READY run can be materialised`
        ),
        { status: 409 }
      )
    }

    const project = await projectRepository.findByIdSimple(args.input.projectId)
    if (!project || project.workspaceId !== run.workspaceId) {
      throw Object.assign(
        new Error('Chosen project does not exist in this workspace'),
        { status: 400 }
      )
    }

    // Idea provenance: every referenced idea must be one this run froze in at
    // start. Blocks planting a foreign/other-run idea into this materialisation.
    const frozen = new Set(run.inputIdeaIds)
    for (const draft of args.input.drafts) {
      for (const ideaId of draft.ideaIds) {
        if (!frozen.has(ideaId)) {
          throw Object.assign(
            new Error(
              `Idea ${ideaId} was not part of this plan run's input snapshot`
            ),
            { status: 400 }
          )
        }
      }
    }

    // Keep only drafts with ≥1 kept task; drop struck tasks.
    const initiatives = args.input.drafts
      .map(draft => ({
        goalStatement: draft.goalStatement,
        assumptionNote: draft.assumptionNote ?? null,
        ideaIds: draft.ideaIds,
        tasks: draft.tasks
          .filter(t => t.keep)
          .map(t => ({
            title: t.title,
            description: t.why,
            sizeHint: SIZE_TO_HINT[t.size],
          })),
      }))
      .filter(init => init.tasks.length > 0)

    if (initiatives.length === 0) {
      throw Object.assign(
        new Error('No tasks were kept — nothing to materialise'),
        { status: 400 }
      )
    }

    return planMaterializeRepository.materialize({
      planRunId: run.id,
      teamId: run.teamId,
      workspaceId: run.workspaceId,
      projectId: args.input.projectId,
      proseDocument: args.input.proseDocument,
      confirmedBy: args.memberId,
      humanConfirmedOutput: {
        prose: args.input.proseDocument,
        drafts: args.input.drafts,
      },
      initiatives,
    })
  },
}

export type { MaterializeResult }
