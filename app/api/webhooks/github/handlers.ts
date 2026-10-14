import { waitUntil } from '@/lib/runtime/wait-until'
import { getActorClerkId, getHumanActorId } from '@/lib/actor'
// Import branch helpers from the sub-module, NOT the '@/lib/integrations/github'
// barrel — the barrel re-exports auth.ts (octokit), which we don't need here and
// which is hostile to load in non-server contexts (LUM-616).
import {
  parseBranchIdentifier,
  splitIdentifier,
} from '@/lib/integrations/github/branch'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack'
import type { NotificationPayload } from '@/lib/integrations/slack'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import type { WebhookTask } from '@/lib/repositories/github.repository'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { stampLineageInBackground } from '@/lib/services/lineage-outcome.service'
import { enqueueFaithfulnessJudgeOnMerge } from '@/lib/services/claim-faithfulness-trigger'
import { enqueueCrossingRejudgeOnPrClose } from '@/lib/services/boundary-crossing-rejudge-trigger'
import { gitOutcomeRecorder } from '@/lib/services/outcome/git-outcome-recorder'
import { emitCoreEvent } from '@/lib/plugins/events'
import { shouldNotifySlackEvent } from '@/lib/services/notification.service'

// ── Types ────────────────────────────────────────────────────────────────────

type GitHubPR = {
  number: number
  title: string
  html_url: string
  state: string
  merged: boolean
  draft: boolean
  user: { login: string }
  merged_by?: { login: string } | null
  // LUM-746: `sha` is on every pull_request payload; optional so a stripped
  // payload degrades to a head fetch on the request path.
  head: { ref: string; sha?: string }
  base: { ref: string }
  merged_at: string | null
  closed_at: string | null
  merge_commit_sha: string | null
  // LUM-634: present on pull_request events; optional so a stripped/older
  // payload degrades to null (never a fabricated 0).
  additions?: number
  deletions?: number
  changed_files?: number
}

type PullRequestPayload = {
  action: string
  pull_request: GitHubPR
  repository: { full_name: string }
}

type CheckSuitePayload = {
  action: string
  check_suite: {
    head_sha: string
    head_branch: string
    conclusion: string | null
    pull_requests: Array<{ number: number }>
  }
  repository: { full_name: string }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** "octocat (GitHub)" — a GitHub login shown as the actor of a PR event. */
function githubActorName(login: string | undefined): string | undefined {
  return login ? `${login} (GitHub)` : undefined
}

async function findTaskForBranch(
  headBranch: string,
  workspaceId: string,
  repo: string
): Promise<WebhookTask | null> {
  const identifier = parseBranchIdentifier(headBranch)
  if (!identifier) return null
  const parts = splitIdentifier(identifier)
  if (!parts) return null

  return githubService.findTaskByIdentifier(
    parts.teamIdentifier,
    parts.number,
    workspaceId,
    repo
  )
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handlePullRequest(
  payload: Record<string, unknown>,
  workspaceId: string,
  integrationId: string | null
): Promise<void> {
  const {
    action,
    pull_request: pr,
    repository,
  } = payload as unknown as PullRequestPayload

  // LUM-1133: ready_for_review / converted_to_draft keep `isDraft` current
  // (a task-less draft is reviewed once it is marked ready).
  const relevantActions = [
    'opened',
    'reopened',
    'closed',
    'synchronize',
    'edited',
    'ready_for_review',
    'converted_to_draft',
  ]
  if (!relevantActions.includes(action)) return

  // LUM-828: derive state from the payload, never from the action — an
  // 'edited' event on an already-merged PR must stay merged, not revert to open.
  const state = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open'

  const task = await findTaskForBranch(
    pr.head.ref,
    workspaceId,
    repository.full_name
  )

  const prRow = await githubService.upsertPullRequest({
    workspaceId,
    taskId: task?.id ?? null,
    integrationId,
    repo: repository.full_name,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    state,
    authorLogin: pr.user.login,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    isDraft: pr.draft,
    // LUM-598 groundwork: persist the merge commit SHA so future automated
    // revert detection can map a later "Revert <sha>" back to this delivery.
    mergeCommitSha: state === 'merged' ? (pr.merge_commit_sha ?? null) : null,
    // LUM-634: change volume straight off the payload. A missing field stays
    // null (fail-closed — the repository skips null so it never clobbers a
    // backfilled value, and 0 is only ever a real zero reported by GitHub).
    additions: typeof pr.additions === 'number' ? pr.additions : null,
    deletions: typeof pr.deletions === 'number' ? pr.deletions : null,
    changedFiles:
      typeof pr.changed_files === 'number' ? pr.changed_files : null,
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
  })

  // LUM-929: an ambiguous branch only stops a NEW link; the row's existing
  // link keeps its task (see githubService.resolvePullRequestTask).
  const linkedTask = await githubService.resolvePullRequestTask(
    task,
    prRow.taskId
  )

  // The plugin event for this PR. LUM-1133: emitted for a PR without a task
  // too (taskId null) so it can be reviewed; everything below stays
  // task-only (branch list, lineage, notifications).
  const prEvent = {
    workspaceId,
    pullRequestId: prRow.id,
    action,
    state,
    repo: repository.full_name,
    prNumber: pr.number,
    isDraft: pr.draft === true,
  }

  if (!linkedTask) {
    emitCoreEvent('github.pullRequest', { ...prEvent, taskId: null })
    return
  }

  // Ensure the branch appears in the task's branch list whenever a PR
  // event references it — covers branches created outside Lumo and
  // branches that were deleted before any push event was tracked
  await githubService.upsertTaskBranch({
    taskId: linkedTask.id,
    repo: repository.full_name,
    branchName: pr.head.ref,
  })

  // LUM-1061: plugins react to a task-linked PR event — the security plugin
  // scans the current head of an open PR (LUM-732; static analysis only,
  // LUM-837: typecheck/test verdicts come from the customer's own CI via
  // handleCheckSuite). Fire-and-forget; handlers register their own waitUntil.
  emitCoreEvent('github.pullRequest', { ...prEvent, taskId: linkedTask.id })

  // Close the task's lineage edges when this PR reaches a terminal state
  // (merged → MERGED, closed → REJECTED). Detached; the stamp is idempotent so
  // redelivery or the getTaskDetail poller double-firing is harmless. Gated on
  // the 'closed' action so a post-merge edit does not re-fire them (LUM-828).
  if (action === 'closed' && state !== 'open') {
    stampLineageInBackground(s => s.stampForPrState(linkedTask.id, state))
    // Auto-judge claim faithfulness the moment a delivery merges (LUM-612).
    // No-op for 'closed'; the hourly cron is the reconciliation backstop.
    enqueueFaithfulnessJudgeOnMerge(state, linkedTask.id)
    // LUM-780: the review window closed — re-judge the task's blocking
    // TEST_FILE_DELETED crossings against every linked PR's file list.
    enqueueCrossingRejudgeOnPrClose(state, linkedTask.id)
  }

  const workspaceSlug = await githubService.findWorkspaceSlug(workspaceId)
  const taskIdentifier = buildTaskIdentifier(
    linkedTask.team.identifier,
    linkedTask.number
  )
  const taskUrl = buildTaskUrl(
    workspaceSlug,
    linkedTask.project.name,
    linkedTask.team.identifier,
    linkedTask.number
  )

  if (action === 'opened' || action === 'reopened') {
    if (
      linkedTask.status === 'BACKLOG' ||
      linkedTask.status === 'TODO' ||
      linkedTask.status === 'IN_PROGRESS'
    ) {
      const prOpenedPayload: NotificationPayload = {
        entityKind: 'task',
        entityId: linkedTask.id,
        entityTitle: linkedTask.title,
        entityIdentifier: taskIdentifier,
        entityUrl: taskUrl,
        actorName: githubActorName(pr.user?.login),
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.html_url,
      }
      waitUntil(
        sendChannelNotification(
          workspaceId,
          'pr_opened',
          prOpenedPayload,
          linkedTask.projectId
        )
      )
      const ownerActorId = linkedTask.project.ownerId
        ? await getHumanActorId(linkedTask.project.ownerId)
        : null
      const ownerClerkId = ownerActorId
        ? await getActorClerkId(ownerActorId)
        : null
      if (ownerActorId && ownerClerkId) {
        // LUM-1101: personal DM honours the owner's Slack preference.
        waitUntil(
          (async () => {
            if (!(await shouldNotifySlackEvent(ownerActorId, 'pr_opened'))) {
              return
            }
            await sendDMNotification(
              workspaceId,
              ownerClerkId,
              'pr_opened',
              prOpenedPayload
            )
          })()
        )
      }
    }
  } else if (action === 'closed' && pr.merged) {
    const mergePayload: NotificationPayload = {
      entityKind: 'task',
      entityId: linkedTask.id,
      entityTitle: linkedTask.title,
      entityIdentifier: taskIdentifier,
      entityUrl: taskUrl,
      actorName: githubActorName(pr.merged_by?.login),
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.html_url,
    }
    waitUntil(
      sendChannelNotification(
        workspaceId,
        'pr_merged',
        mergePayload,
        linkedTask.projectId
      )
    )
    const assigneeActorId = linkedTask.assigneeActorId
    if (assigneeActorId) {
      const assigneeClerkId = await getActorClerkId(assigneeActorId)
      if (assigneeClerkId) {
        // LUM-1101: personal DM honours the assignee's Slack preference.
        waitUntil(
          (async () => {
            if (!(await shouldNotifySlackEvent(assigneeActorId, 'pr_merged'))) {
              return
            }
            await sendDMNotification(
              workspaceId,
              assigneeClerkId,
              'pr_merged',
              mergePayload
            )
          })()
        )
      }
    }
  }
}

// ── Push handler ─────────────────────────────────────────────────────────────

type PushCommitPayload = { id: string; message: string }

type PushPayload = {
  ref: string // "refs/heads/lumo/ENG-123-fix-bug"
  deleted: boolean
  head_commit: {
    id: string
    message: string
    author: { name: string }
  } | null
  commits?: PushCommitPayload[]
  repository: { full_name: string; default_branch: string }
}

/** Distinct commits in this push (head + listed), each with its FULL message —
 *  the `This reverts commit <sha>` trailer lives below the subject line. */
function pushCommits(payload: PushPayload): { sha: string; message: string }[] {
  const bySha = new Map<string, { sha: string; message: string }>()
  for (const c of [...(payload.commits ?? []), payload.head_commit]) {
    if (c?.id && !bySha.has(c.id))
      bySha.set(c.id, { sha: c.id, message: c.message })
  }
  return [...bySha.values()]
}

export async function handlePush(
  payload: Record<string, unknown>,
  workspaceId: string
): Promise<void> {
  const push = payload as unknown as PushPayload
  const { ref, deleted, head_commit, repository } = push

  // Only track branch pushes (not tags), and ignore branch deletions
  if (!ref.startsWith('refs/heads/') || deleted || !head_commit) return

  // LUM-607 — feed the post-hoc outcome well at delivery time: a revert that
  // lands on the default branch records a REVERTED signal for the delivery it
  // undid (sha-membership topology, no git checkout). Detached + fail-soft: a
  // detection error must never break webhook ingestion. Independent of the
  // task-branch lookup below — reverts land on `main`, which maps to no task.
  waitUntil(
    gitOutcomeRecorder
      .recordRevertsFromPush({
        workspaceId,
        ref,
        defaultBranch: repository.default_branch,
        commits: pushCommits(push),
      })
      .then(() => undefined)
      .catch(err => {
        console.error('[webhook] revert outcome detection failed:', err)
      })
  )

  const branchName = ref.slice('refs/heads/'.length)

  // LUM-1061: plugins react to every branch push — the security plugin
  // refreshes the repository baseline on a default-branch push (LUM-738).
  // BEFORE the task lookup below — `main` maps to no task. Fire-and-forget.
  emitCoreEvent('github.push', {
    workspaceId,
    repo: repository.full_name,
    branch: branchName,
    isDefaultBranch: branchName === repository.default_branch,
    headSha: head_commit.id,
  })

  const task = await findTaskForBranch(
    branchName,
    workspaceId,
    repository.full_name
  )
  if (!task) return

  // Use only the first line of the commit message
  const commitMessage = head_commit.message.split('\n')[0]!

  await githubService.upsertTaskBranch({
    taskId: task.id,
    repo: repository.full_name,
    branchName,
    lastCommitSha: head_commit.id,
    lastCommitMessage: commitMessage,
    lastCommitAuthor: head_commit.author.name,
    lastPushedAt: new Date(),
  })
}

export async function handleCheckSuite(
  payload: Record<string, unknown>,
  workspaceId: string
): Promise<void> {
  const {
    action,
    check_suite: suite,
    repository,
  } = payload as unknown as CheckSuitePayload

  if (action !== 'completed') return

  const ciStatus =
    suite.conclusion === 'success'
      ? 'success'
      : suite.conclusion === null
        ? 'pending'
        : 'failure'

  const prNumbers = suite.pull_requests.map(pr => pr.number)
  if (prNumbers.length > 0) {
    await githubService.updatePullRequestCiStatus(
      workspaceId,
      repository.full_name,
      prNumbers,
      ciStatus
    )
  }
}

// ── Comment mirror handlers ───────────────────────────────────────────────────

type InboundAction =
  | 'created'
  | 'edited'
  | 'deleted'
  | 'submitted'
  | 'dismissed'

export async function handleIssueComment(
  payload: Record<string, unknown>,
  workspaceId: string,
  _integrationId: string | null
): Promise<void> {
  const issue = payload.issue as
    | {
        number: number
        pull_request?: unknown
        user?: { login?: string } | null
      }
    | undefined
  if (!issue?.pull_request) return // real issue, not a PR
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  if (!repo) return
  const pr = await pullRequestRepository.findByRepoAndNumber(
    workspaceId,
    repo,
    issue.number
  )
  // A PR Lumo holds no row for: nothing to mirror, nothing to command.
  if (!pr) return
  // LUM-1129: any PR row — `@<app> review` must work on a PR with no task.
  const comment = (payload.comment ?? {}) as {
    id?: number
    body?: string
    created_at?: string
    user?: { login?: string; type?: string } | null
  }
  if (typeof comment.id === 'number') {
    const user = comment.user ?? null
    emitCoreEvent('github.issueComment', {
      workspaceId,
      pullRequestId: pr.id,
      repo,
      prNumber: issue.number,
      action: typeof payload.action === 'string' ? payload.action : 'created',
      comment: {
        id: comment.id,
        body: typeof comment.body === 'string' ? comment.body : '',
        createdAt:
          typeof comment.created_at === 'string' ? comment.created_at : null,
        user: user
          ? {
              ...(typeof user.login === 'string' ? { login: user.login } : {}),
              ...(typeof user.type === 'string' ? { type: user.type } : {}),
            }
          : null,
      },
      prAuthorLogin:
        typeof issue.user?.login === 'string' ? issue.user.login : null,
    })
  }
  if (!pr.taskId) return
  await prCommentMirrorService.runInbound({
    event: 'issue_comment',
    action: (payload.action as InboundAction) ?? 'created',
    workspaceId,
    taskId: pr.taskId,
    pullRequestId: pr.id,
    raw: payload,
  })
}

export async function handlePullRequestReview(
  payload: Record<string, unknown>,
  workspaceId: string,
  _integrationId: string | null
): Promise<void> {
  const prRef = payload.pull_request as { number: number } | undefined
  if (!prRef) return
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  if (!repo) return
  const pr = await pullRequestRepository.findByRepoAndNumber(
    workspaceId,
    repo,
    prRef.number
  )
  if (!pr?.taskId) return
  await prCommentMirrorService.runInbound({
    event: 'pull_request_review',
    action: (payload.action as InboundAction) ?? 'submitted',
    workspaceId,
    taskId: pr.taskId,
    pullRequestId: pr.id,
    raw: payload,
  })
}

/**
 * LUM-1127 — `pull_request_review_thread` (resolved / unresolved): handed to
 * the plugins as `github.reviewThread`, which records a human resolving one
 * of Lumo's finding threads. Any PR row Lumo holds — not only task-linked
 * ones: a scan's threads exist wherever the scan commented.
 */
export async function handlePullRequestReviewThread(
  payload: Record<string, unknown>,
  workspaceId: string
): Promise<void> {
  const prRef = payload.pull_request as { number?: number } | undefined
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  const action = payload.action
  if (!prRef?.number || !repo || typeof action !== 'string') return
  const pr = await pullRequestRepository.findByRepoAndNumber(
    workspaceId,
    repo,
    prRef.number
  )
  if (!pr) return
  const thread = (payload.thread ?? {}) as {
    node_id?: string
    comments?: Array<{
      id?: number
      body?: string
      user?: { type?: string; login?: string } | null
      in_reply_to_id?: number | null
    }>
  }
  const sender = (payload.sender ?? null) as {
    login?: string
    type?: string
  } | null
  emitCoreEvent('github.reviewThread', {
    workspaceId,
    pullRequestId: pr.id,
    action,
    threadNodeId: typeof thread.node_id === 'string' ? thread.node_id : null,
    comments: (thread.comments ?? [])
      .filter(c => typeof c.id === 'number')
      .map(c => ({
        id: c.id as number,
        body: typeof c.body === 'string' ? c.body : '',
        user: c.user ?? null,
        in_reply_to_id: c.in_reply_to_id ?? null,
      })),
    sender: sender
      ? {
          ...(typeof sender.login === 'string' ? { login: sender.login } : {}),
          ...(typeof sender.type === 'string' ? { type: sender.type } : {}),
        }
      : null,
  })
}

export async function handlePullRequestReviewComment(
  payload: Record<string, unknown>,
  workspaceId: string,
  _integrationId: string | null
): Promise<void> {
  const prRef = payload.pull_request as { number: number } | undefined
  if (!prRef) return
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  if (!repo) return
  const pr = await pullRequestRepository.findByRepoAndNumber(
    workspaceId,
    repo,
    prRef.number
  )
  if (!pr?.taskId) return
  await prCommentMirrorService.runInbound({
    event: 'pull_request_review_comment',
    action: (payload.action as InboundAction) ?? 'created',
    workspaceId,
    taskId: pr.taskId,
    pullRequestId: pr.id,
    raw: payload,
  })
}
