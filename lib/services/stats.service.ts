import { statsRepository } from '@/lib/repositories/stats.repository'
import {
  aggregateProjectStats,
  aggregateSprintBlockers,
} from '@/lib/summaries/stats'
import { STALE_PR_DAYS } from '@/lib/summaries/top-blockers'
import { reconcileStaleProjectPrs } from './stale-pr-reconcile.service'
import type { TaskSummaryStats, TopBlockers } from '@/types/summary'

export async function getProjectStats(
  projectId: string,
  workspaceId: string
): Promise<TaskSummaryStats> {
  const [project, workspace] = await Promise.all([
    statsRepository.findProjectId(projectId),
    statsRepository.findWorkspaceId(workspaceId),
  ])

  if (!project)
    throw Object.assign(new Error('Project not found'), { status: 404 })
  if (!workspace)
    throw Object.assign(new Error('Workspace not found'), { status: 404 })

  // Correct any drifted PR state before aggregating, so a PR that was merged
  // without its webhook landing doesn't get counted (and shown) as a stale PR
  // awaiting review. Fail-soft and bounded — see the service for why this runs
  // on the read path rather than only in a background job.
  await reconcileStaleProjectPrs(projectId, workspaceId, STALE_PR_DAYS)

  return aggregateProjectStats(projectId)
}

/**
 * Sprint-dimension blockers. The caller already loaded the sprint and passes
 * its workspaceId so the workspace is validated on this path too.
 */
export async function getSprintBlockers(
  sprintId: string,
  workspaceId: string
): Promise<TopBlockers> {
  const workspace = await statsRepository.findWorkspaceId(workspaceId)
  if (!workspace)
    throw Object.assign(new Error('Workspace not found'), { status: 404 })

  return aggregateSprintBlockers(sprintId)
}
