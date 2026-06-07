import { waitUntil } from '@vercel/functions'
import { getActorClerkId, getHumanActorId } from '@/lib/actor'
import {
  parseBranchIdentifier,
  splitIdentifier,
} from '@/lib/integrations/github'
import {
  sendChannelNotification,
  sendDMNotification,
} from '@/lib/integrations/slack'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import type { Task, Project } from '@prisma/client'
import { githubService } from '@/lib/services/github.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'

// ── Types ────────────────────────────────────────────────────────────────────

type GitHubPR = {
  number: number
  title: string
  html_url: string
  state: string
  merged: boolean
  draft: boolean
  user: { login: string }
  head: { ref: string }
  base: { ref: string }
  merged_at: string | null
  closed_at: string | null
}

type PullRequestPayload = {
  action: string
  pull_request: GitHubPR
  repository: { full_name: string }
}

type CheckSuitePayload = {
  action: string
  check_suite: {
    head_branch: string
    conclusion: string | null
    pull_requests: Array<{ number: number }>
  }
  repository: { full_name: string }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findTaskForBranch(
  headBranch: string,
  workspaceId: string
): Promise<
  | (Task & {
      project: Pick<Project, 'ownerId' | 'workspaceId'>
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

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function handlePullRequest(
  payload: Record<string, unknown>,
  workspaceId: string,
  integrationId: string
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

  await githubService.upsertPullRequest({
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
    baseBranch: pr.base.ref,
    isDraft: pr.draft,
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

  // Close the task's lineage edges when this PR reaches a terminal state
  // (merged → MERGED, closed → REJECTED). Fire-and-forget; the stamp is
  // idempotent so redelivery or the getTaskDetail poller double-firing is
  // harmless. Dynamic import keeps the lineage repository→prisma chain out of
  // every test module that loads these webhook handlers.
  if (state !== 'open') {
    waitUntil(
      (async () => {
        const { lineageOutcomeService } = await import(
          '@/lib/services/lineage-outcome.service'
        )
        await lineageOutcomeService.stampForPrState(task.id, state)
      })().catch(() => {})
    )
  }

  const workspaceSlug = await githubService.findWorkspaceSlug(workspaceId)
  const taskIdentifier = buildTaskIdentifier(task.team.identifier, task.number)
  const taskUrl = buildTaskUrl(workspaceSlug, task.team.identifier, task.number)

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

type PushPayload = {
  ref: string // "refs/heads/lumo/ENG-123-fix-bug"
  deleted: boolean
  head_commit: {
    id: string
    message: string
    author: { name: string }
  } | null
  repository: { full_name: string }
}

export async function handlePush(
  payload: Record<string, unknown>,
  workspaceId: string
): Promise<void> {
  const { ref, deleted, head_commit, repository } =
    payload as unknown as PushPayload

  // Only track branch pushes (not tags), and ignore branch deletions
  if (!ref.startsWith('refs/heads/') || deleted || !head_commit) return

  const branchName = ref.slice('refs/heads/'.length)
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
  _workspaceId: string
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
  if (prNumbers.length === 0) return

  await githubService.updatePullRequestCiStatus(
    repository.full_name,
    prNumbers,
    ciStatus
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
  _integrationId: string
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
  _integrationId: string
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
  _integrationId: string
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
