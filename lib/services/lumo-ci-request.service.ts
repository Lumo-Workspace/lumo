/**
 * LUM-746 — the request half of the managed CI: decide whether a PR head
 * gets a run, keep the "same sha runs once" and cost rules, and start the
 * workflow. Called detached (waitUntil) from the PR webhook and the manual
 * link path through `lumo-ci-dispatch.ts`, which lazy-loads this module —
 * it reaches the GitHub client (octokit) via `fetchPrHeadSha`.
 *
 * Order matters and mirrors LUM-745:
 *   1. create the row  (unique collision ⇒ already requested, stop)
 *   2. supersede older PENDING runs of the PR — stamp, THEN cancel + stop VM
 *   3. hourly cap       (at the cap ⇒ row FAILED rate-limited, nothing starts)
 *   4. start()          (null ⇒ row FAILED; a never-started row costs no quota)
 */
import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { lumoCiRunRepository } from '@/lib/repositories/lumo-ci-run.repository'
import { fetchPrHeadSha } from '@/lib/integrations/github/contents'
import { stopRepoSandboxesByTag } from '@/lib/integrations/vercel-sandbox'
import { cancelLumoCiRun, startLumoCi } from './lumo-ci-start'
import {
  LUMO_CI_SANDBOX_TAG,
  MANAGED_CI_HOURLY_WINDOW_MS,
  isManagedCiEnabled,
  jestShardCount,
  managedCiHourlyCap,
  type LumoCiJob,
} from './lumo-ci.config'

export type CiRequestTrigger = 'PR_EVENT' | 'PR_LINK'

export type CiRequestOutcome =
  | {
      kind: 'skipped'
      reason:
        | 'disabled'
        | 'pr_not_found'
        | 'no_task'
        | 'not_open'
        | 'invalid_head_sha'
        | 'already_requested'
      ciRunId?: string
    }
  | { kind: 'capped'; ciRunId: string }
  | { kind: 'failed'; ciRunId: string; reason: string }
  | { kind: 'started'; ciRunId: string; runId: string }

const HEAD_SHA_RE = /^[0-9a-f]{7,40}$/

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Stamp first, then kill: the stamp is what a retry of the old run reads. */
async function supersedeOlderRuns(
  pullRequestId: string,
  exceptId: string,
  newHeadSha: string
): Promise<void> {
  let older
  try {
    older = await lumoCiRunRepository.findPendingByPullRequest(
      pullRequestId,
      exceptId
    )
  } catch (error) {
    logger.warn(
      `[lumo-ci] supersede lookup failed pr=${pullRequestId}: ${describe(error)}`
    )
    return
  }
  for (const row of older) {
    try {
      await lumoCiRunRepository.finish(row.id, {
        status: 'SUPERSEDED',
        error: `superseded by ${newHeadSha.slice(0, 7)}`,
      })
    } catch (error) {
      // Unstamped → leave the run alone (it will finish and record honestly).
      logger.warn(
        `[lumo-ci] supersede stamp failed ci=${row.id}: ${describe(error)}`
      )
      continue
    }
    if (row.runId) await cancelLumoCiRun(row.runId, row.id)
    try {
      await stopRepoSandboxesByTag({ [LUMO_CI_SANDBOX_TAG]: row.id })
    } catch (error) {
      logger.warn(
        `[lumo-ci] sandbox stop failed ci=${row.id}: ${describe(error)}`
      )
    }
  }
}

export const lumoCiRequestService = {
  async requestRun(input: {
    pullRequestId: string
    trigger: CiRequestTrigger
    /** From the webhook payload when available; fetched otherwise. */
    headSha?: string
  }): Promise<CiRequestOutcome> {
    if (!isManagedCiEnabled()) return { kind: 'skipped', reason: 'disabled' }
    const pr = await pullRequestRepository.findById(input.pullRequestId)
    if (!pr) return { kind: 'skipped', reason: 'pr_not_found' }
    if (!pr.taskId) return { kind: 'skipped', reason: 'no_task' }
    if (pr.state !== 'open') return { kind: 'skipped', reason: 'not_open' }

    const headSha =
      input.headSha ??
      (await fetchPrHeadSha({
        workspaceId: pr.workspaceId,
        fullName: pr.repo,
        prNumber: pr.number,
      }))
    if (!HEAD_SHA_RE.test(headSha)) {
      return { kind: 'skipped', reason: 'invalid_head_sha' }
    }

    const row = await lumoCiRunRepository.create({
      workspaceId: pr.workspaceId,
      taskId: pr.taskId,
      pullRequestId: pr.id,
      prNumber: pr.number,
      headSha,
    })
    if (!row.created) {
      return { kind: 'skipped', reason: 'already_requested', ciRunId: row.id }
    }

    await supersedeOlderRuns(pr.id, row.id, headSha)

    const cap = managedCiHourlyCap()
    const since = new Date(Date.now() - MANAGED_CI_HOURLY_WINDOW_MS)
    const started = await lumoCiRunRepository.countStartedSince(
      pr.workspaceId,
      since
    )
    if (started >= cap) {
      const reason = `rate-limited: ${started} managed CI runs started in the last hour (cap ${cap})`
      logger.warn(`[lumo-ci] ${reason} workspace=${pr.workspaceId}`)
      await lumoCiRunRepository.finish(row.id, {
        status: 'FAILED',
        error: reason,
      })
      return { kind: 'capped', ciRunId: row.id }
    }

    const job: LumoCiJob = {
      ciRunId: row.id,
      workspaceId: pr.workspaceId,
      taskId: pr.taskId,
      pullRequestId: pr.id,
      repo: pr.repo,
      prNumber: pr.number,
      headSha,
      jestShards: jestShardCount(),
    }
    const runId = await startLumoCi(job)
    if (!runId) {
      await lumoCiRunRepository.finish(row.id, {
        status: 'FAILED',
        error: 'workflow start failed',
      })
      return {
        kind: 'failed',
        ciRunId: row.id,
        reason: 'workflow start failed',
      }
    }
    await lumoCiRunRepository.setRunId(row.id, runId)
    logger.info(
      `[lumo-ci] requested ${pr.repo}#${pr.number}@${headSha.slice(0, 7)} trigger=${input.trigger} ci=${row.id}`
    )
    return { kind: 'started', ciRunId: row.id, runId }
  },
}
