import { waitUntil } from '@vercel/functions'
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
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import type { Task, Project } from '@prisma/client'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { stampLineageInBackground } from '@/lib/services/lineage-outcome.service'
import { enqueueFaithfulnessJudgeOnMerge } from '@/lib/services/claim-faithfulness-trigger'
import { enqueueCrossingRejudgeOnPrClose } from '@/lib/services/boundary-crossing-rejudge-trigger'
import { gitOutcomeRecorder } from '@/lib/services/outcome/git-outcome-recorder'
import { ciSignalService } from '@/lib/services/ci-signal.service'
import {
  dispatchPrSecurityScan,
  shouldScanOnPrEvent,
} from '@/lib/services/pr-security-scan-dispatch'
import { dispatchLumoCi } from '@/lib/services/lumo-ci-dispatch'
import { logger } from '@/lib/logger'

// ── Types ────────────────────────────────────────────────────────────────────

type GitHubPR = {
  number: number
  title: string
  html_url: string
  state: string
  merged: boolean
  draft: boolean
  user: { login: string }
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

type StatusPayload = {
  sha: string
  state: string
  branches?: Array<{ name: string }>
  repository: { full_name: string }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findTaskForBranch(
  headBranch: string,
  workspaceId: string
): Promise<
  | (Task & {
      project: Pick<Project, 'name' | 'ownerId' | 'workspaceId'>
      team: { identifier: string }
    })
  | null
> {
  const identifier = parseBranchIdentifier(headBranch)
  if (!identifier) return null
  const parts = splitIdentifier(identifier)
  if (!parts) return null

  return githubService.findTaskByIdentifier(
    parts.teamIdentifier,
    parts.number,
    workspaceId
  )
}

/**
 * Resolve the Lumo task a commit belongs to (LUM-616): first by any PR number
 * the CI signal references (the PR↔task link), then by parsing the head branch.
 * Returns null when nothing maps — e.g. CI on a non-task branch like `main`.
 */
async function resolveTaskIdForCommit(args: {
  workspaceId: string
  repo: string
  prNumbers: number[]
  headBranch?: string | undefined
}): Promise<string | null> {
  for (const number of args.prNumbers) {
    const pr = await pullRequestRepository.findByRepoAndNumber(
      args.repo,
      number
    )
    if (pr?.taskId) return pr.taskId
  }
  if (args.headBranch) {
    const task = await findTaskForBranch(args.headBranch, args.workspaceId)
    if (task) return task.id
  }
  return null
}

/**
 * Resolve which PR a CI commit belongs to (LUM-617), stored on each GateSignal
 * so the gate audit can group by PR. Prefers the event's own PR list
 * (check_suite); falls back to the head branch (status events). Null when
 * neither resolves — the audit then buckets the signal as unlinked.
 */
async function resolvePrNumberForCommit(args: {
  repo: string
  prNumbers: number[]
  headBranch?: string | undefined
}): Promise<number | null> {
  const [first] = args.prNumbers
  if (first != null) return first
  if (args.headBranch) {
    const pr = await pullRequestRepository.findByHeadBranch(
      args.repo,
      args.headBranch
    )
    if (pr) return pr.number
  }
  return null
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

  const relevantActions = [
    'opened',
    'reopened',
    'closed',
    'synchronize',
    'edited',
  ]
  if (!relevantActions.includes(action)) return

  const state =
    action === 'closed' && pr.merged
      ? 'merged'
      : action === 'closed'
        ? 'closed'
        : 'open'

  const task = await findTaskForBranch(pr.head.ref, workspaceId)

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

  // Ensure the branch appears in the task's branch list whenever a PR
  // event references it — covers branches created outside Lumo and
  // branches that were deleted before any push event was tracked
  if (task) {
    await githubService.upsertTaskBranch({
      taskId: task.id,
      repo: repository.full_name,
      branchName: pr.head.ref,
    })
  }

  if (!task) return

  // LUM-732: every push to a task-linked open PR gets a security scan of its
  // current head. The worker dedups on (pr, headSha), so redelivery is harmless.
  if (shouldScanOnPrEvent(action, state)) {
    waitUntil(dispatchPrSecurityScan(prRow.id, 'PR_EVENT'))
    // LUM-746: the same pushes get a Lumo-managed CI run (typecheck + test
    // in a sandbox → independent gate signals). Same-sha dedup is the
    // request path's job, so redelivery is harmless here too.
    waitUntil(dispatchLumoCi(prRow.id, 'PR_EVENT', pr.head.sha))
  }

  // Close the task's lineage edges when this PR reaches a terminal state
  // (merged → MERGED, closed → REJECTED). Detached; the stamp is idempotent so
  // redelivery or the getTaskDetail poller double-firing is harmless.
  if (state !== 'open') {
    stampLineageInBackground(s => s.stampForPrState(task.id, state))
    // Auto-judge claim faithfulness the moment a delivery merges (LUM-612).
    // No-op for 'closed'; the hourly cron is the reconciliation backstop.
    enqueueFaithfulnessJudgeOnMerge(state, task.id)
    // LUM-780: the review window closed — re-judge the task's blocking
    // TEST_FILE_DELETED crossings against every linked PR's file list.
    enqueueCrossingRejudgeOnPrClose(state, task.id)
  }

  const workspaceSlug = await githubService.findWorkspaceSlug(workspaceId)
  const taskIdentifier = buildTaskIdentifier(task.team.identifier, task.number)
  const taskUrl = buildTaskUrl(
    workspaceSlug,
    task.project.name,
    task.team.identifier,
    task.number
  )

  if (action === 'opened' || action === 'reopened') {
    if (task.status === 'TODO' || task.status === 'IN_PROGRESS') {
      const prOpenedPayload = {
        taskId: task.id,
        taskTitle: task.title,
        taskIdentifier,
        taskUrl,
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.html_url,
      }
      waitUntil(
        sendChannelNotification(
          workspaceId,
          'pr_opened',
          prOpenedPayload,
          task.projectId
        )
      )
      const ownerActorId = task.project.ownerId
        ? await getHumanActorId(task.project.ownerId)
        : null
      const ownerClerkId = ownerActorId
        ? await getActorClerkId(ownerActorId)
        : null
      if (ownerClerkId) {
        waitUntil(
          sendDMNotification(
            workspaceId,
            ownerClerkId,
            'pr_opened',
            prOpenedPayload
          )
        )
      }
    }
  } else if (action === 'closed' && pr.merged) {
    const mergePayload = {
      taskId: task.id,
      taskTitle: task.title,
      taskIdentifier,
      taskUrl,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.html_url,
    }
    waitUntil(
      sendChannelNotification(
        workspaceId,
        'pr_merged',
        mergePayload,
        task.projectId
      )
    )
    if (task.assigneeActorId) {
      const assigneeClerkId = await getActorClerkId(task.assigneeActorId)
      if (assigneeClerkId) {
        waitUntil(
          sendDMNotification(
            workspaceId,
            assigneeClerkId,
            'pr_merged',
            mergePayload
          )
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

  // LUM-738 — a push to the default branch moves the repository security
  // baseline: refresh the default-branch fingerprint set that decides
  // whether a PR's dependency finding is new or already there. Detached +
  // fail-soft, and BEFORE the task lookup below — `main` maps to no task.
  if (branchName === repository.default_branch) {
    // Dynamic import: the baseline service reaches github/contents → auth
    // (octokit, ESM) and the workflow start; keeping it off this module's
    // static graph keeps the webhook handlers loadable where that chain is
    // not (the same boundary stage A draws around the LLM gateway).
    waitUntil(
      import('@/lib/services/security-baseline.service')
        .then(({ securityBaselineService }) =>
          securityBaselineService.requestFromPush({
            workspaceId,
            repo: repository.full_name,
            sha: head_commit.id,
          })
        )
        .then(() => undefined)
        .catch(err => {
          logger.warn(
            '[webhook] security baseline request failed:',
            err instanceof Error ? err.message : String(err)
          )
        })
    )
  }

  const task = await findTaskForBranch(branchName, workspaceId)
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
      repository.full_name,
      prNumbers,
      ciStatus
    )
  }

  // LUM-616: derive independent per-gate signals from this commit's CI. Detached
  // + fail-soft — reconcile owns its errors and must never break ingestion.
  if (suite.head_sha) {
    const [taskId, prNumber] = await Promise.all([
      resolveTaskIdForCommit({
        workspaceId,
        repo: repository.full_name,
        prNumbers,
        headBranch: suite.head_branch,
      }),
      resolvePrNumberForCommit({
        repo: repository.full_name,
        prNumbers,
        headBranch: suite.head_branch,
      }),
    ])
    waitUntil(
      ciSignalService.reconcileCommit({
        workspaceId,
        repo: repository.full_name,
        headSha: suite.head_sha,
        taskId,
        prNumber,
      })
    )
  }
}

/**
 * LUM-623 SHA→PR fallback for handleStatus. Loaded lazily (the `./checks` module
 * transitively pulls the octokit ESM auth client that is hostile to jest) and
 * fully fail-soft: a GitHub error resolves to [] so the webhook never breaks —
 * mirrors ci-signal.service's own lazy-import + swallow contract.
 */
async function pullNumbersForCommitSafe(
  workspaceId: string,
  fullName: string,
  sha: string
): Promise<number[]> {
  try {
    const { fetchPullNumbersForCommit } =
      await import('@/lib/integrations/github/checks')
    return await fetchPullNumbersForCommit({ workspaceId, fullName, sha })
  } catch (err) {
    logger.error(
      `[github/status] SHA→PR fallback failed for ${fullName}@${sha}: ${err}`
    )
    return []
  }
}

/**
 * Commit-status event (LUM-616) — the other CI surface, used by providers that
 * report via the Status API (Travis, Jenkins, classic CircleCI) rather than the
 * Checks API. Same reconcile path as check_suite, keyed on the commit SHA.
 */
export async function handleStatus(
  payload: Record<string, unknown>,
  workspaceId: string
): Promise<void> {
  const { sha, branches, repository } = payload as unknown as StatusPayload
  if (!sha) return

  const headBranch = branches?.[0]?.name

  // LUM-623: a commit-status can land AFTER its PR squash-merged and the head
  // branch was deleted — then `branches` is empty and branch-based resolution
  // finds nothing, silently dropping the CI signal (the Vercel-status race that
  // left multi-PR audit rows blank). Recover the PR↔task link from the commit
  // SHA, which GitHub still answers post-merge. Best-effort: any lookup error is
  // swallowed so ingestion never breaks — the signal just stays unlinked.
  const prNumbers = headBranch
    ? []
    : await pullNumbersForCommitSafe(workspaceId, repository.full_name, sha)

  const [taskId, prNumber] = await Promise.all([
    resolveTaskIdForCommit({
      workspaceId,
      repo: repository.full_name,
      prNumbers,
      headBranch,
    }),
    resolvePrNumberForCommit({
      repo: repository.full_name,
      prNumbers,
      headBranch,
    }),
  ])
  waitUntil(
    ciSignalService.reconcileCommit({
      workspaceId,
      repo: repository.full_name,
      headSha: sha,
      taskId,
      prNumber,
    })
  )
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
    | { number: number; pull_request?: unknown }
    | undefined
  if (!issue?.pull_request) return // real issue, not a PR
  const repo = (payload.repository as { full_name?: string } | undefined)
    ?.full_name
  if (!repo) return
  const pr = await pullRequestRepository.findByRepoAndNumber(repo, issue.number)
  if (!pr?.taskId) return
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
  const pr = await pullRequestRepository.findByRepoAndNumber(repo, prRef.number)
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
  const pr = await pullRequestRepository.findByRepoAndNumber(repo, prRef.number)
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
