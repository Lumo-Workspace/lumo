import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { parseBranchIdentifier, splitIdentifier } from '@/lib/github/branch'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'
import type { Task, Project } from '@prisma/client'

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
      project: Pick<Project, 'defaultReviewerId' | 'workspaceId'>
      team: { identifier: string }
    })
  | null
> {
  const identifier = parseBranchIdentifier(headBranch)
  if (!identifier) return null
  const parts = splitIdentifier(identifier)
  if (!parts) return null

  return prisma.task.findFirst({
    where: {
      number: parts.number,
      team: { identifier: parts.teamIdentifier, workspaceId },
    },
    include: {
      project: { select: { defaultReviewerId: true, workspaceId: true } },
      team: { select: { identifier: true } },
    },
  })
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

  await prisma.pullRequest.upsert({
    where: { repo_number: { repo: repository.full_name, number: pr.number } },
    create: {
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
    },
    update: {
      title: pr.title,
      state,
      isDraft: pr.draft,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      ...(task ? { taskId: task.id } : {}),
    },
  })

  // Ensure the branch appears in the task's branch list whenever a PR
  // event references it — covers branches created outside Lumo and
  // branches that were deleted before any push event was tracked
  if (task) {
    await prisma.taskBranch.upsert({
      where: {
        taskId_repo_branchName: {
          taskId: task.id,
          repo: repository.full_name,
          branchName: pr.head.ref,
        },
      },
      create: {
        taskId: task.id,
        repo: repository.full_name,
        branchName: pr.head.ref,
      },
      update: {},
    })
  }

  if (!task) return

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true },
  })
  const workspaceSlug = workspace?.slug ?? ''
  const taskIdentifier = `${task.team.identifier}-${task.number}`
  const taskUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/tasks/${taskIdentifier}`

  if (action === 'opened' || action === 'reopened') {
    if (task.status === 'TODO' || task.status === 'IN_PROGRESS') {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'IN_REVIEW' },
      })
      // Resolve project.defaultReviewerId (WorkspaceMember.id) → Actor ID
      let defaultReviewerActorId: string | null = null
      if (task.project.defaultReviewerId) {
        const actor = await prisma.actor.findUnique({
          where: { memberId: task.project.defaultReviewerId },
          select: { id: true },
        })
        defaultReviewerActorId = actor?.id ?? null
      }
      notifyTaskInReview({
        workspaceId,
        taskId: task.id,
        reviewerActorId: task.reviewerActorId,
        defaultReviewerActorId,
        triggerActorId: null,
      }).catch(err => console.error('[webhook] notifyTaskInReview error:', err))
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
      if (task.reviewerActorId) {
        prisma.actor
          .findUnique({
            where: { id: task.reviewerActorId },
            select: { member: { select: { clerkId: true } } },
          })
          .then(actor => {
            if (actor?.member)
              waitUntil(
                sendDMNotification(
                  workspaceId,
                  actor.member.clerkId,
                  'pr_opened',
                  prOpenedPayload
                )
              )
          })
          .catch(err => console.error('[slack] pr_opened DM failed:', err))
      }
    }
  } else if (action === 'closed' && pr.merged) {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'DONE' },
    })
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
    waitUntil(
      sendChannelNotification(
        workspaceId,
        'task_done',
        {
          taskId: task.id,
          taskTitle: task.title,
          taskIdentifier,
          taskUrl,
        },
        task.projectId
      )
    )
    if (task.assigneeActorId) {
      prisma.actor
        .findUnique({
          where: { id: task.assigneeActorId },
          select: { member: { select: { clerkId: true } } },
        })
        .then(actor => {
          if (actor?.member) {
            waitUntil(
              sendDMNotification(
                workspaceId,
                actor.member.clerkId,
                'pr_merged',
                mergePayload
              )
            )
            waitUntil(
              sendDMNotification(
                workspaceId,
                actor.member.clerkId,
                'task_done',
                {
                  taskId: task.id,
                  taskTitle: task.title,
                  taskIdentifier,
                  taskUrl,
                }
              )
            )
          }
        })
        .catch(err => console.error('[slack] pr_merged DM failed:', err))
    }
  } else if (action === 'closed' && !pr.merged) {
    if (task.status === 'IN_REVIEW') {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'IN_PROGRESS' },
      })
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

  await prisma.taskBranch.upsert({
    where: {
      taskId_repo_branchName: {
        taskId: task.id,
        repo: repository.full_name,
        branchName,
      },
    },
    create: {
      taskId: task.id,
      repo: repository.full_name,
      branchName,
      lastCommitSha: head_commit.id,
      lastCommitMessage: commitMessage,
      lastCommitAuthor: head_commit.author.name,
      lastPushedAt: new Date(),
    },
    update: {
      lastCommitSha: head_commit.id,
      lastCommitMessage: commitMessage,
      lastCommitAuthor: head_commit.author.name,
      lastPushedAt: new Date(),
    },
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

  await prisma.pullRequest.updateMany({
    where: { repo: repository.full_name, number: { in: prNumbers } },
    data: { ciStatus },
  })
}
