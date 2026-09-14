import {
  milestoneRepository,
  type MilestoneListFilter,
} from '@/lib/repositories/milestone.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { milestoneExitCriterionRepository } from '@/lib/repositories/milestone-exit-criterion.repository'
import { projectService } from '@/lib/services/project.service'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { computeSprintCoverage } from '@/lib/summaries/sprint-coverage'
import { computeMilestoneOutcome } from '@/lib/summaries/milestone-outcome'
import { computeMilestoneGreenQuality } from '@/lib/summaries/milestone-green-quality'
import { parseSnapshotCriteria } from '@/lib/fidelity/change-pattern'
import { computeMilestoneBurnup } from '@/lib/summaries/milestone-burnup'
import { computeMilestoneTokenBudget } from '@/lib/summaries/milestone-token-budget'
import { computeMilestoneSegments } from '@/lib/summaries/milestone-segments'
import { computeMilestoneDeliveryStats } from '@/lib/summaries/milestone-delivery-stats'
import { computeMilestoneMemberDelivery } from '@/lib/summaries/milestone-member-delivery'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import {
  computeMilestoneRiskQueue,
  type MilestoneRiskQueue,
  type RiskQueueCrossingRow,
} from '@/lib/summaries/milestone-risk-queue'
import {
  computeMilestoneTopology,
  type MilestoneTopology,
} from '@/lib/summaries/milestone-topology'
import {
  computeWeightedProgress,
  type MilestoneWeightedProgress,
} from '@/lib/summaries/milestone-weighted-progress'
import {
  buildMilestoneSlugBase,
  resolveUniqueMilestoneSlug,
} from '@/lib/utils/milestone-slug'
import { buildMilestoneUrl } from '@/lib/utils/buildMilestoneUrl'
import { getActorClerkId } from '@/lib/actor'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'
import { htmlToPreview } from '@/lib/utils/htmlToPreview'
import { waitUntil } from '@vercel/functions'

interface CreateInput {
  name: string
  description?: string | null | undefined
  startDate?: Date | undefined
  targetDate?: Date | undefined
}

interface UpdateInput {
  name?: string | undefined
  description?: string | null | undefined
  startDate?: Date | null | undefined
  targetDate?: Date | null | undefined
  /** LUM-644 advisory token budget; null clears it. */
  tokenBudget?: number | null | undefined
}

/**
 * Fire-and-forget milestone retro generation, triggered when a milestone
 * transitions to COMPLETED (mirrors sprint close). The dynamic imports keep
 * `@ai-sdk/gateway` (pulled transitively by the LLM client) out of
 * milestone.service's static dependency graph, so jest test files importing
 * milestone.service don't crash loading the gateway transform.
 */
export async function generateMilestoneRetro(
  milestoneId: string
): Promise<void> {
  try {
    const { generationJobRepository } =
      await import('@/lib/repositories/generation-job.repository')
    await generationJobRepository.createMilestonePending(milestoneId)

    const { milestoneSummaryService } =
      await import('@/lib/services/milestone-summary.service')
    await milestoneSummaryService.generate(milestoneId)
  } catch (err) {
    void err
  }
}

/**
 * Resolve a milestone and authorize the caller against its project's
 * workspace, in a single pass (one `findById` + one `getProject`). Throws 404
 * when the milestone is missing. Shared by every read that needs both the
 * milestone row and an access check, so the work isn't duplicated per call.
 */
async function authorizeMilestone(milestoneId: string, memberId: string) {
  const milestone = await milestoneRepository.findById(milestoneId)
  if (!milestone) {
    throw Object.assign(new Error('Milestone not found'), { status: 404 })
  }
  const project = await projectService.getProject(milestone.projectId, memberId)
  return { milestone, project }
}

/**
 * Aggregate sprint coverage for an ALREADY-authorized milestone whose team is
 * known. Assumes the caller has verified access — performs no auth itself.
 */
async function sprintCoverageForTeam(milestoneId: string, teamId: string) {
  const counts = await milestoneRepository.sprintCoverageCounts(milestoneId)
  const sprintIds = [
    ...new Set(
      counts.map(c => c.sprintId).filter((id): id is string => id !== null)
    ),
  ]
  const sprints = await sprintRepository.findByIds(sprintIds, teamId)
  return computeSprintCoverage(counts, sprints)
}

export const milestoneService = {
  async listMilestones(
    projectId: string,
    memberId: string,
    filter: MilestoneListFilter = 'active',
    search?: string
  ) {
    await projectService.getProject(projectId, memberId)
    return milestoneRepository.findByProject(projectId, filter, search)
  },

  async getMilestone(milestoneId: string, memberId: string) {
    const { milestone } = await authorizeMilestone(milestoneId, memberId)
    return milestone
  },

  /**
   * Authorize and return the milestone together with its resolved team id, so
   * a caller (e.g. the detail route) can authorize once and then fetch sprint
   * coverage via `getSprintCoverageForTeam` without a second findById/getProject.
   */
  async getMilestoneWithTeam(milestoneId: string, memberId: string) {
    const { milestone, project } = await authorizeMilestone(
      milestoneId,
      memberId
    )
    return { milestone, teamId: project.teamId }
  },

  /**
   * Self-contained sprint coverage: authorizes, then aggregates. Kept as the
   * standalone public entry point. Callers that have already authorized the
   * milestone and resolved its team should use `getSprintCoverageForTeam` to
   * avoid the redundant findById + getProject.
   */
  async getSprintCoverage(milestoneId: string, memberId: string) {
    const { project } = await authorizeMilestone(milestoneId, memberId)
    return sprintCoverageForTeam(milestoneId, project.teamId)
  },

  /**
   * Sprint coverage for an already-authorized milestone whose team is known.
   * Performs NO auth — only call after authorizing (e.g. via
   * `getMilestoneWithTeam`).
   */
  async getSprintCoverageForTeam(milestoneId: string, teamId: string) {
    return sprintCoverageForTeam(milestoneId, teamId)
  },

  /**
   * LUM-626 outcome rollup (hard results + post-delivery fate) for an
   * already-authorized milestone. Performs NO auth — only call after
   * authorizing (e.g. via `getMilestoneWithTeam`).
   */
  async getOutcomeForMilestone(milestoneId: string) {
    const [{ tasks, signalCounts }, greenQualityRows] = await Promise.all([
      milestoneRepository.outcomeRollupRows(milestoneId),
      milestoneRepository.greenQualityRows(milestoneId),
    ])
    const outcome = computeMilestoneOutcome(
      tasks.map(t => ({
        id: t.id,
        ref: `${t.team.identifier}-${t.number}`,
        title: t.title,
        status: t.status,
        claimSnapshot: t.claimSnapshot,
        claimSnapshotSource: t.claimSnapshotSource,
      })),
      signalCounts
    )
    // LUM-639 acceptance-quality footnote — rides the outcome block so both
    // detail read paths (by-id and by-slug) return it from this one place.
    const greenQuality = computeMilestoneGreenQuality(
      greenQualityRows.map(t => ({
        id: t.id,
        status: t.status,
        verificationRounds: t.forecastSnapshot?.verificationRounds ?? null,
        sendBackCount: t.forecastSnapshot?.sendBackCount ?? null,
        faithfulnessVerdict: t.claimFaithfulness?.verdict ?? null,
        snapshotCriteria:
          t.criteriaSnapshots.length > 0
            ? parseSnapshotCriteria(t.criteriaSnapshots[0]?.criteria)
            : null,
      }))
    )
    return { ...outcome, greenQuality }
  },

  /**
   * LUM-627 cost+trend rollup for an already-authorized milestone: the member
   * tasks' token/active-time actuals (same-source with the task-level LUM-560
   * cost via `retrospectiveRepository`, fail-closed on unmeasured) plus the
   * cross-sprint burnup trajectory (backward replay of STATUS_CHANGED).
   * LUM-644 adds the advisory budget block: `tokenBudget` is the milestone
   * row's value (the caller already holds the row — required so BOTH detail
   * read paths pass it, the LUM-624 lesson), compared against the same
   * measured burn, fail-closed to unknown when unmeasured. Advisory only.
   * Performs NO auth — only call after authorizing (e.g. via
   * `getMilestoneWithTeam`).
   */
  async getCostTrendForMilestone(
    milestoneId: string,
    teamId: string,
    tokenBudget: number | null
  ) {
    const { tasks, activities } =
      await milestoneRepository.costTrendRows(milestoneId)
    const sprintIds = [
      ...new Set(
        tasks.map(t => t.sprintId).filter((id): id is string => id !== null)
      ),
    ]
    const [sprints, actuals] = await Promise.all([
      sprintRepository.findByIds(sprintIds, teamId),
      retrospectiveRepository.loadActualsForTasks(tasks.map(t => t.id)),
    ])
    // LUM-636 derived start: the earliest first-exit-from-TODO across member
    // tasks (Task.workStartedAt — set once, never reset). Activity truth for
    // the hero's Start date; null until some task actually starts. The stored
    // milestone.startDate, when a human set one, still wins at render time.
    let derivedStartDate: string | null = null
    for (const t of tasks) {
      if (!t.workStartedAt) continue
      const iso = t.workStartedAt.toISOString()
      if (derivedStartDate === null || iso < derivedStartDate) {
        derivedStartDate = iso
      }
    }
    return {
      derivedStartDate,
      costRollup: {
        tokenCost: actuals.tokenCost,
        activeTimeSec: actuals.activeTimeSec,
        measuredTasks: actuals.measuredTasks,
        totalTasks: tasks.length,
        // LUM-636 per-model split — same measured sessions, empty when no
        // session carries a usageByModel map (older CLIs); the explicit
        // unattributed remainder keeps Σ honest.
        models: actuals.models,
        modelUnattributedTokens: actuals.modelUnattributedTokens,
      },
      // LUM-644 advisory burn-vs-budget; null when no budget is set.
      budget: computeMilestoneTokenBudget({
        tokenBudget,
        tokenCost: actuals.tokenCost,
      }),
      burnup: computeMilestoneBurnup({
        tasks,
        activities,
        sprints,
        now: new Date(),
      }),
    }
  },

  /**
   * LUM-646: per-milestone F2 budget signal for the `lumo next --claimable`
   * gate. Returns milestoneId → exceeded, where `true` means the milestone's
   * MEASURED burn is over its advisory token budget (LUM-644). `null` = no
   * budget set, or burn unmeasured — fail-open on the unknown, so only a
   * measured overrun ever gates a task out of the claimable pool. Ids that
   * resolve to no milestone map to `null`.
   */
  async getBudgetExceededForMilestones(
    milestoneIds: string[]
  ): Promise<Map<string, boolean | null>> {
    const out = new Map<string, boolean | null>()
    const unique = [...new Set(milestoneIds)]
    await Promise.all(
      unique.map(async milestoneId => {
        const milestone = await milestoneRepository.findById(milestoneId)
        if (!milestone || milestone.tokenBudget == null) {
          out.set(milestoneId, null)
          return
        }
        const taskIds = await milestoneRepository.taskIds(milestoneId)
        const actuals =
          await retrospectiveRepository.loadActualsForTasks(taskIds)
        const status = computeMilestoneTokenBudget({
          tokenBudget: milestone.tokenBudget,
          tokenCost: actuals.tokenCost,
        })
        out.set(milestoneId, status?.exceeded ?? null)
      })
    )
    return out
  },

  /**
   * LUM-632 delivery-scale + per-member spend rollup for an already-authorized
   * milestone: merged-PR / multi-PR-churn / unlinked buckets, the summed
   * change surface (per-task changedFileCount with measurement coverage), and
   * token/active-time attributed to `Session.workspaceMemberId` (the actual
   * spender, never the assignee). Same-source with the LUM-627 costRollup, so
   * the per-member Σ reconciles exactly with it. LUM-634 adds the line-level
   * change volume over merged PRs (three-state fail-closed: unsynced null ≠
   * real 0 ≠ zero-synced milestone) — both detail routes get it through this
   * single call. Performs NO auth — only call after authorizing (e.g. via
   * `getMilestoneWithTeam`).
   */
  async getDeliveryStatsForMilestone(milestoneId: string) {
    // LUM-727: the same task set, now with its display identity so the BY
    // TASK breakdown can label its rows.
    const taskRefs = await milestoneRepository.taskRefs(milestoneId)
    const taskIds = taskRefs.map(t => t.id)
    const taskLabels = new Map(
      taskRefs.map(t => [t.id, { ref: t.ref, title: t.title }])
    )
    const [prRows, complexityRows, actualRows] = await Promise.all([
      pullRequestRepository.listStatesByTaskIds(taskIds),
      taskComplexityRepository.listByTaskIds(taskIds),
      retrospectiveRepository.loadMemberActualRowsForTasks(taskIds),
    ])
    const memberIds = [
      ...new Set(
        actualRows.sessions
          .map(s => s.workspaceMemberId)
          .filter((id): id is string => !!id)
      ),
    ]
    const memberLabels = await memberRepository.labelsByIds(memberIds)
    return computeMilestoneDeliveryStats({
      taskIds,
      prRows,
      complexityRows,
      sessionRows: actualRows.sessions,
      turnEvents: actualRows.turnEvents,
      memberLabels,
      taskLabels,
    })
  },

  /**
   * LUM-633 per-member delivery rollup for an already-authorized milestone:
   * DONE / merged-PR / fate / friction / change-surface counts grouped by the
   * task ASSIGNEE (agent actors folded to a person — owner for personal
   * agents, top token spender for shared ones), with explicit unassigned and
   * unattributed buckets, plus each member's DONE tasks' frozen claims
   * (same sourcing as the LUM-626 outcome section). Counts only — no ratio
   * appears anywhere in the payload. Pure read model, zero schema change.
   * Performs NO auth — only call after authorizing (e.g. via
   * `getMilestoneWithTeam`).
   */
  async getMemberDeliveryForMilestone(milestoneId: string) {
    const { tasks, signalCounts } =
      await milestoneRepository.memberDeliveryRows(milestoneId)
    const taskIds = tasks.map(t => t.id)
    const [prRows, complexityRows, sessionRows, verificationRows] =
      await Promise.all([
        pullRequestRepository.listStatesByTaskIds(taskIds),
        taskComplexityRepository.listByTaskIds(taskIds),
        retrospectiveRepository.loadSessionTokenRowsForTasks(taskIds),
        verificationRunRepository.failRowsByTaskIds(taskIds),
      ])
    const taskRows = tasks.map(t => ({
      id: t.id,
      ref: `${t.team.identifier}-${t.number}`,
      title: t.title,
      status: t.status,
      claimSnapshot: t.claimSnapshot,
      claimSnapshotSource: t.claimSnapshotSource,
      assignee: t.assignee
        ? {
            actorType: t.assignee.type,
            actorMemberId: t.assignee.memberId,
            agentOwnerMemberId: t.assignee.agent?.memberId ?? null,
          }
        : null,
    }))
    // Labels for every member a row can land on: direct member actors, agent
    // owners, and session spenders (the shared-agent fold candidates).
    const memberIds = [
      ...new Set([
        ...taskRows.flatMap(t =>
          t.assignee
            ? [t.assignee.actorMemberId, t.assignee.agentOwnerMemberId]
            : []
        ),
        ...sessionRows.map(s => s.workspaceMemberId),
      ]),
    ].filter((id): id is string => !!id)
    const memberLabels = await memberRepository.labelsByIds(memberIds)
    return computeMilestoneMemberDelivery({
      tasks: taskRows,
      prRows,
      complexityRows,
      sessionRows,
      verificationRows,
      signalCounts,
      memberLabels,
    })
  },

  /**
   * LUM-628 segmentation rollup for an already-authorized milestone: member
   * tasks grouped by sprint / priority / workstream (=tag), each segment
   * carrying total+done counts and the task rows the drill-down renders.
   * Performs NO auth — only call after authorizing (e.g. via
   * `getMilestoneWithTeam`).
   */
  async getSegmentsForMilestone(milestoneId: string, teamId: string) {
    const rows = await milestoneRepository.segmentationRows(milestoneId)
    const sprintIds = [
      ...new Set(
        rows.map(r => r.sprintId).filter((id): id is string => id !== null)
      ),
    ]
    const sprints = await sprintRepository.findByIds(sprintIds, teamId)
    return computeMilestoneSegments(
      rows.map(r => ({
        id: r.id,
        ref: `${r.team.identifier}-${r.number}`,
        title: r.title,
        status: r.status,
        priority: r.priority,
        sprintId: r.sprintId,
        tags: r.taskTags.map(t => t.tag),
      })),
      sprints
    )
  },

  /**
   * LUM-638 risk queue. The crossings fetch is isolated in its own
   * try/catch: a read failure degrades that block to `unknown`
   * (crossings: null → { known: false }) instead of failing the payload —
   * unknown is not zero.
   */
  async getRiskQueueForMilestone(
    milestoneId: string
  ): Promise<MilestoneRiskQueue | null> {
    const rows = await milestoneRepository.riskQueueRows(milestoneId)
    if (!rows) return null
    let crossings: RiskQueueCrossingRow[] | null
    try {
      crossings = await boundaryCrossingRepository.findSeverityRowsByTaskIds(
        rows.tasks.map(t => t.id)
      )
    } catch {
      crossings = null
    }
    return computeMilestoneRiskQueue({ ...rows, crossings, now: new Date() })
  },

  /**
   * LUM-645 dependency topology: layered order, unweighted critical path and
   * the recommended next batch, over CONFIRMED BLOCKS edges (the honesty
   * filter lives in the pure fn).
   */
  async getTopologyForMilestone(
    milestoneId: string
  ): Promise<MilestoneTopology | null> {
    const rows = await milestoneRepository.topologyRows(milestoneId)
    if (!rows) return null
    return computeMilestoneTopology(rows)
  },

  /**
   * LUM-650 complexity-weighted progress reading for the Overview ring — a
   * current-status snapshot weighting DONE tasks by TaskComplexity
   * .changedFileCount over the measured tasks. Unmeasured tasks (no complexity
   * row) are carried as coverage only, never a 0 weight (three-state, LUM-634).
   */
  async getWeightedProgressForMilestone(
    milestoneId: string
  ): Promise<MilestoneWeightedProgress> {
    const tasks = await milestoneRepository.taskStatusRows(milestoneId)
    const complexityRows = await taskComplexityRepository.listByTaskIds(
      tasks.map(t => t.id)
    )
    const weightByTask = new Map<string, number>()
    for (const row of complexityRows) {
      if (!weightByTask.has(row.taskId)) {
        weightByTask.set(row.taskId, row.changedFileCount)
      }
    }
    return computeWeightedProgress(
      tasks.map(t => ({
        status: t.status,
        changedFileCount: weightByTask.has(t.id)
          ? weightByTask.get(t.id)!
          : null,
      }))
    )
  },

  async getMilestoneBySlug(projectId: string, slug: string, memberId: string) {
    await projectService.getProject(projectId, memberId)
    const milestone = await milestoneRepository.findByProjectAndSlug(
      projectId,
      slug
    )
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    return milestone
  },

  async createMilestone(
    projectId: string,
    memberId: string,
    input: CreateInput
  ) {
    await projectService.getProject(projectId, memberId)
    const existingSlugs = new Set(
      await milestoneRepository.findSlugsByProject(projectId)
    )
    const slug = resolveUniqueMilestoneSlug(
      buildMilestoneSlugBase(input.name),
      existingSlugs
    )
    const maxSortOrder = await milestoneRepository.getMaxSortOrder(projectId)
    const sortOrder = maxSortOrder === null ? 0 : maxSortOrder + 1
    return milestoneRepository.create({
      projectId,
      name: input.name,
      slug,
      description: input.description ?? null,
      sortOrder,
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
    })
  },

  async updateMilestone(
    milestoneId: string,
    memberId: string,
    input: UpdateInput
  ) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    const project = await projectService.getProject(
      existing.projectId,
      memberId
    )
    if (existing.archivedAt) {
      throw Object.assign(
        new Error('Milestone is archived; unarchive it before editing'),
        { status: 409 }
      )
    }

    const oldDescription = existing.description
    const data: Record<string, unknown> = {}
    if (input.name !== undefined) data.name = input.name
    if (input.description !== undefined) data.description = input.description
    if (input.startDate !== undefined) data.startDate = input.startDate
    if (input.targetDate !== undefined) data.targetDate = input.targetDate
    if (input.tokenBudget !== undefined) data.tokenBudget = input.tokenBudget

    const updated = await milestoneRepository.update(milestoneId, data)

    // Notify users newly @-mentioned in the milestone description (delta only).
    // Resolution + send is fully fire-and-forget so a lookup failure never
    // breaks the save — nothing notify-related is awaited on the path to return.
    // (The `getProject` auth call above stays on the main path; only the
    // notify-specific lookups move into the background callback.)
    if (input.description !== undefined) {
      const newHtml = input.description
      waitUntil(
        (async () => {
          const authorActor =
            await memberRepository.findActorByMemberId(memberId)
          const [authorClerkId, ws] = await Promise.all([
            authorActor
              ? getActorClerkId(authorActor.id)
              : Promise.resolve(null),
            workspaceRepository.findNameAndSlug(project.workspaceId),
          ])
          if (authorActor?.id && authorClerkId && ws?.slug) {
            const milestoneUrl = buildMilestoneUrl(
              ws.slug,
              project.name,
              updated.slug
            )
            await notifyMentionDelta({
              oldHtml: oldDescription ?? '',
              newHtml,
              authorClerkId,
              authorActorId: authorActor.id,
              workspaceId: project.workspaceId,
              notificationType: 'MILESTONE_MENTIONED',
              ref: { milestoneId: updated.id },
              slackEvent: 'comment_mention',
              slackPayload: {
                taskTitle: updated.name,
                taskUrl: milestoneUrl,
                commentBody: htmlToPreview(newHtml),
              },
              waitUntil,
            })
          }
        })().catch(() => {})
      )
    }

    return updated
  },

  /**
   * LUM-714 close override — the successor to the old `--status completed`
   * `?force=1` path. Completion is derived now, so there is no status to set:
   * this stamps `completedAt` directly, past the LUM-643 exit-criteria gate,
   * and records the override trail. Human-initiated paths only (the route
   * gates it on the Clerk source — the agent/Bearer path has no override).
   *
   * Without unresolved criteria there is nothing to override, so the call is
   * refused (409) rather than quietly stamping a completion the rollup would
   * have reached on its own — or, worse, one the tasks don't support.
   */
  async overrideMilestoneClose(
    milestoneId: string,
    memberId: string,
    overrideNote: string | null
  ) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)

    const unresolved =
      await milestoneExitCriterionRepository.listUnresolved(milestoneId)
    if (unresolved.length === 0) {
      throw Object.assign(
        new Error(
          'Nothing to override: this milestone has no unresolved exit criteria. Completion is derived from task completion.'
        ),
        { status: 409 }
      )
    }

    const updated = await milestoneRepository.update(milestoneId, {
      completedAt: new Date(),
      completedOverrideAt: new Date(),
      completedOverrideByMemberId: memberId,
      completedOverrideNote: overrideNote,
    })
    // Mirrors the derived-completion path: the retro rides on the transition.
    void generateMilestoneRetro(milestoneId)
    return updated
  },

  async deleteMilestone(milestoneId: string, memberId: string) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)
    await milestoneRepository.delete(milestoneId)
  },

  async reorderMilestones(
    projectId: string,
    memberId: string,
    orderedIds: string[]
  ) {
    await projectService.getProject(projectId, memberId)

    const milestones = await milestoneRepository.findByProject(projectId)
    const known = new Set(milestones.map(m => m.id))

    if (new Set(orderedIds).size !== orderedIds.length) {
      throw Object.assign(new Error('orderedIds must not contain duplicates'), {
        status: 400,
      })
    }
    const unknown = orderedIds.find(id => !known.has(id))
    if (unknown) {
      throw Object.assign(
        new Error('orderedIds contains a milestone not in this project'),
        { status: 400 }
      )
    }
    if (orderedIds.length !== milestones.length) {
      throw Object.assign(
        new Error('orderedIds must list every milestone in the project'),
        { status: 400 }
      )
    }

    await milestoneRepository.reorder(projectId, orderedIds)
  },

  async archiveMilestone(milestoneId: string, memberId: string) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)
    if (existing.archivedAt) return existing
    return milestoneRepository.archive(milestoneId, new Date())
  },

  async unarchiveMilestone(milestoneId: string, memberId: string) {
    const existing = await milestoneRepository.findById(milestoneId)
    if (!existing) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(existing.projectId, memberId)
    if (!existing.archivedAt) return existing
    return milestoneRepository.unarchive(milestoneId)
  },

  /**
   * All milestones in the viewer's workspace (for the task-view config picker).
   * Scope comes from the authenticated identity's workspaceId — no per-project
   * authorization needed since it is the caller's own workspace.
   */
  async listByWorkspace(
    workspaceId: string,
    filter: MilestoneListFilter = 'active'
  ) {
    return milestoneRepository.findByWorkspace(workspaceId, filter)
  },

  async listTasks(
    milestoneId: string,
    memberId: string,
    opts: { assigneeActorId?: string }
  ) {
    const milestone = await milestoneRepository.findById(milestoneId)
    if (!milestone) {
      throw Object.assign(new Error('Milestone not found'), { status: 404 })
    }
    await projectService.getProject(milestone.projectId, memberId)
    return taskRepository.findByMilestone({
      milestoneId,
      ...(opts.assigneeActorId && { assigneeActorId: opts.assigneeActorId }),
    })
  },
}

export type MilestoneService = typeof milestoneService
