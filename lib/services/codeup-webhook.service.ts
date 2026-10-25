import { logger } from '@/lib/logger'
import { featureStage, isFeatureEnabled } from '@/lib/features/is-enabled'
// The branch helpers module only — not the GitHub barrel (octokit, LUM-616).
import {
  parseBranchIdentifier,
  splitIdentifier,
} from '@/lib/integrations/github/branch'
import {
  CODEUP_MERGE_REQUEST_EVENT,
  CODEUP_PUSH_EVENT,
  deliveryRepositoryId,
  parseMergeRequestEvent,
  parsePushEvent,
  webhookTokenMatches,
} from '@/lib/integrations/codeup/webhook'
import { codeupRepository } from '@/lib/repositories/codeup.repository'
import {
  githubRepository,
  type WebhookTask,
} from '@/lib/repositories/github.repository'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CodeupDelivery {
  event: string | null
  token: string | null
  payload: unknown
}

export type CodeupDeliveryOutcome =
  | 'unauthorized'
  | 'disabled'
  | 'ignored'
  | 'handled'

export interface CodeupDeliveryResult {
  status: 200 | 401 | 404
  outcome: CodeupDeliveryOutcome
}

interface ConfirmedRepo {
  workspaceId: string
  repositoryId: number
  pathWithNamespace: string
}

const RESULT = {
  unauthorized: { status: 401, outcome: 'unauthorized' },
  disabled: { status: 404, outcome: 'disabled' },
  ignored: { status: 200, outcome: 'ignored' },
  handled: { status: 200, outcome: 'handled' },
} as const satisfies Record<CodeupDeliveryOutcome, CodeupDeliveryResult>

// ── Task lookup ─────────────────────────────────────────────────────────────

/**
 * The task a Codeup branch names, in this workspace. Same rule as the GitHub
 * lookup (LUM-925): when another workspace that confirmed the same
 * repository also has this identifier, the branch cannot be placed and no
 * task is returned.
 */
export async function findTaskForCodeupBranch(
  branchName: string,
  repo: ConfirmedRepo
): Promise<WebhookTask | null> {
  const identifier = parseBranchIdentifier(branchName)
  const parts = identifier ? splitIdentifier(identifier) : null
  if (!parts) return null

  const task = await githubRepository.findTaskByIdentifier(
    parts.teamIdentifier,
    parts.number,
    repo.workspaceId
  )
  if (!task) return null

  const confirming = await codeupRepository.findOtherConfirmingWorkspaceIds(
    repo.repositoryId,
    repo.workspaceId
  )
  if (confirming.length === 0) return task
  const holders = new Set(
    await githubRepository.findOtherWorkspaceIdsWithTask(
      parts.teamIdentifier,
      parts.number,
      repo.workspaceId
    )
  )
  if (confirming.some(id => holders.has(id))) {
    logger.warn(
      `[codeup] ${identifier} in ${repo.pathWithNamespace} matches tasks in more than one workspace — not linking it automatically`
    )
    return null
  }
  return task
}

// ── Event handlers ──────────────────────────────────────────────────────────

/** `Merge Request Hook`: upsert the workspace's PR row and link its task. */
export async function handleCodeupMergeRequest(
  payload: unknown,
  repo: ConfirmedRepo
): Promise<CodeupDeliveryOutcome> {
  const mr = parseMergeRequestEvent(payload)
  if (!mr) return 'ignored'

  const task = await findTaskForCodeupBranch(mr.sourceBranch, repo)
  const row = await codeupRepository.upsertMergeRequest({
    workspaceId: repo.workspaceId,
    taskId: task?.id ?? null,
    repo: repo.pathWithNamespace,
    number: mr.iid,
    title: mr.title,
    url: mr.url,
    state: mr.state,
    authorLogin: mr.authorLogin,
    headBranch: mr.sourceBranch,
    headSha: mr.headSha,
    baseBranch: mr.targetBranch,
    isDraft: mr.isDraft,
    mergedAt: mr.state === 'merged' ? (mr.updatedAt ?? new Date()) : null,
    closedAt: mr.state === 'open' ? null : (mr.updatedAt ?? new Date()),
  })

  // LUM-929: an unplaceable branch only stops a NEW link; an existing one
  // keeps its task, and the branch shows on that task.
  const taskId = task?.id ?? row.taskId
  if (taskId) {
    await codeupRepository.upsertTaskBranch({
      taskId,
      repo: repo.pathWithNamespace,
      branchName: mr.sourceBranch,
    })
  }
  return 'handled'
}

/** `Push Hook`: record the branch's latest commit on the task it names. */
export async function handleCodeupPush(
  payload: unknown,
  repo: ConfirmedRepo
): Promise<CodeupDeliveryOutcome> {
  const push = parsePushEvent(payload)
  if (!push) return 'ignored'
  const task = await findTaskForCodeupBranch(push.branchName, repo)
  if (!task) return 'ignored'
  await codeupRepository.upsertTaskBranch({
    taskId: task.id,
    repo: repo.pathWithNamespace,
    branchName: push.branchName,
    lastCommitSha: push.headSha,
    ...(push.commitMessage ? { lastCommitMessage: push.commitMessage } : {}),
    ...(push.commitAuthor ? { lastCommitAuthor: push.commitAuthor } : {}),
    lastPushedAt: new Date(),
  })
  return 'handled'
}

// ── Delivery ────────────────────────────────────────────────────────────────

export const codeupWebhookService = {
  /**
   * Authenticate one delivery and hand it to its handler.
   *
   * - feature off everywhere → 404 before anything is read;
   * - no token, or no workspace's hook on this repository has it → 401;
   * - the matched workspace is outside the rollout → 404;
   * - the repository is no longer confirmed, or the event is not one Lumo
   *   reads → 200, ignored;
   * - a handler error is logged and answered 200 (like the GitHub webhook):
   *   the next event for the same MR or branch catches the row up.
   */
  async handleDelivery(
    delivery: CodeupDelivery
  ): Promise<CodeupDeliveryResult> {
    if (featureStage('codeup-integration') === 'off') return RESULT.disabled
    if (!delivery.token) return RESULT.unauthorized

    const repositoryId = deliveryRepositoryId(delivery.payload)
    if (repositoryId === null) return RESULT.unauthorized

    const candidates =
      await codeupRepository.findDeliveryCandidates(repositoryId)
    // Check every candidate so the time taken does not depend on which one
    // matched; each comparison is itself constant-time.
    let match: (typeof candidates)[number] | null = null
    for (const candidate of candidates) {
      if (webhookTokenMatches(delivery.token, candidate.webhookTokenHash)) {
        match ??= candidate
      }
    }
    if (!match) return RESULT.unauthorized
    if (!isFeatureEnabled('codeup-integration', match.workspaceId)) {
      return RESULT.disabled
    }
    if (!match.confirmedAt) return RESULT.ignored

    const repo: ConfirmedRepo = {
      workspaceId: match.workspaceId,
      repositoryId: match.repositoryId,
      pathWithNamespace: match.pathWithNamespace,
    }
    try {
      if (delivery.event === CODEUP_MERGE_REQUEST_EVENT) {
        return RESULT[await handleCodeupMergeRequest(delivery.payload, repo)]
      }
      if (delivery.event === CODEUP_PUSH_EVENT) {
        return RESULT[await handleCodeupPush(delivery.payload, repo)]
      }
      return RESULT.ignored
    } catch (err) {
      logger.error(
        `[webhook/codeup] error handling ${delivery.event} for workspace ${repo.workspaceId}: ${String(err)}`
      )
      return RESULT.handled
    }
  },
}
