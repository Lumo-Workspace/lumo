import { prisma } from '@/lib/db/prisma'
import { AgentError } from './errors'
import { fireProgress } from './pipeline'
import { markRunCompleted } from './run-lifecycle'
import { transitionAgentStatus } from './state-machine'
import {
  transitionTaskStatus,
  type TaskStatusValue,
} from '@/lib/task/state-machine'
import { dispatchEvents } from '@/lib/events/dispatcher'
import { notifyAgentVerify } from '@/lib/services/notification.service'
import type { DomainEvent } from '@/lib/events/types'
import type { RunContext, ChangedFile } from './execute'

// ── GitHub helpers ─────────────────────────────────────────────────────────

export async function createPullRequest(params: {
  owner: string
  repo: string
  branch: string
  title: string
  body: string
  token: string
  baseBranch?: string
}): Promise<{ html_url: string; number: number }> {
  const {
    owner,
    repo,
    branch,
    title,
    body,
    token,
    baseBranch = 'main',
  } = params
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, head: branch, base: baseBranch }),
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new AgentError(
      'PR_CREATE_FAILED',
      `Failed to create PR: ${JSON.stringify(err)}`
    )
  }
  return response.json() as Promise<{ html_url: string; number: number }>
}

export async function findExistingPR(taskId: string, fallbackRepo: string) {
  const existingPr = await prisma.pullRequest.findFirst({
    where: { taskId, state: 'open' },
    select: { url: true, number: true },
  })
  return {
    prUrl: existingPr?.url ?? `https://github.com/${fallbackRepo}/pulls`,
    prNumber: existingPr?.number ?? 0,
  }
}

// ── Run metadata collection (via GitHub API) ────────────────────────────

export async function collectChangedFilesFromGitHub(
  owner: string,
  repo: string,
  baseBranch: string,
  headBranch: string,
  token: string
): Promise<ChangedFile[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${baseBranch}...${headBranch}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  ).catch(() => null)

  if (!res || !res.ok) return []

  const data = (await res.json()) as {
    files?: { filename: string; status: string }[]
  }
  return (data.files ?? []).map(f => ({
    path: f.filename,
    status: mapGitHubFileStatus(f.status),
  }))
}

export function mapGitHubFileStatus(
  status: string
): 'added' | 'modified' | 'deleted' | 'renamed' {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    default:
      return 'modified'
  }
}

export async function collectCommitSummaryFromGitHub(
  owner: string,
  repo: string,
  baseBranch: string,
  headBranch: string,
  token: string
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${baseBranch}...${headBranch}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  ).catch(() => null)

  if (!res || !res.ok) return 'Agent completed successfully'

  const data = (await res.json()) as {
    commits?: { commit: { message: string } }[]
  }
  const messages = (data.commits ?? []).map(
    c => c.commit.message.split('\n')[0]!
  )
  if (messages.length === 1) return messages[0]!
  if (messages.length > 1) return messages.join('; ')
  return 'Agent completed successfully'
}

export async function collectRunMetadata(ctx: {
  repoOwner: string
  repoName: string
  branchName: string
  githubToken: string
}) {
  const baseBranch = 'main'
  const [changedFiles, summary] = await Promise.all([
    collectChangedFilesFromGitHub(
      ctx.repoOwner,
      ctx.repoName,
      baseBranch,
      ctx.branchName,
      ctx.githubToken
    ),
    collectCommitSummaryFromGitHub(
      ctx.repoOwner,
      ctx.repoName,
      baseBranch,
      ctx.branchName,
      ctx.githubToken
    ),
  ])
  return { changedFiles, summary }
}

// ── Branch & PR upsert ──────────────────────────────────────────────────

export function buildBranchUpsert(
  taskId: string,
  resolvedRepo: string,
  branchName: string
) {
  return prisma.taskBranch.upsert({
    where: {
      taskId_repo_branchName: { taskId, repo: resolvedRepo, branchName },
    },
    create: { taskId, repo: resolvedRepo, branchName },
    update: {},
  })
}

export function buildPRUpsert(
  taskId: string,
  resolvedRepo: string,
  branchName: string,
  pr: { workspaceId: string; number: number; title: string; url: string }
) {
  return prisma.pullRequest.upsert({
    where: { repo_number: { repo: resolvedRepo, number: pr.number } },
    create: {
      workspaceId: pr.workspaceId,
      taskId,
      repo: resolvedRepo,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: 'open',
      authorLogin: 'lumo-agent',
      headBranch: branchName,
      baseBranch: 'main',
    },
    update: { state: 'open', url: pr.url, taskId },
  })
}

export async function upsertBranchAndPR(params: {
  taskId: string
  branchName: string
  resolvedRepo: string
  prUpsertData?: {
    workspaceId: string
    number: number
    title: string
    url: string
  }
}) {
  const branchOp = buildBranchUpsert(
    params.taskId,
    params.resolvedRepo,
    params.branchName
  )
  if (params.prUpsertData) {
    const prOp = buildPRUpsert(
      params.taskId,
      params.resolvedRepo,
      params.branchName,
      params.prUpsertData
    )
    await prisma.$transaction([branchOp, prOp])
  } else {
    await branchOp
  }
}

// ── Complete agent run ────────────────────────────────────────────────────

export async function transitionStatuses(
  taskId: string,
  projectId: string,
  taskStatus: string
): Promise<DomainEvent[]> {
  const agentEvents = await transitionAgentStatus(
    taskId,
    projectId,
    'COMPLETED',
    { skipDispatch: true }
  )
  const taskEvents = await tryTransitionTaskStatus(
    taskId,
    projectId,
    taskStatus
  )
  return [...agentEvents, ...taskEvents]
}

export async function tryTransitionTaskStatus(
  taskId: string,
  projectId: string,
  taskStatus: string
): Promise<DomainEvent[]> {
  try {
    return await transitionTaskStatus(taskId, projectId, 'IN_REVIEW', {
      currentStatus: taskStatus as TaskStatusValue,
      skipDispatch: true,
    })
  } catch {
    console.warn(
      `[Agent] Skipping task status → IN_REVIEW: invalid from ${taskStatus}`
    )
    return []
  }
}

export async function completeAgentRun(params: {
  taskId: string
  projectId: string
  taskStatus: string
  branchName: string
  resolvedRepo: string
  agentRunId: string
  agentSummary?: string | null
  agentChangedFiles?: ChangedFile[]
  agentDurationMs: number
  prUpsertData?: {
    workspaceId: string
    number: number
    title: string
    url: string
  }
}): Promise<void> {
  const events = await transitionStatuses(
    params.taskId,
    params.projectId,
    params.taskStatus
  )
  await upsertBranchAndPR(params)
  await dispatchEvents(events)
  await markRunCompleted(params.agentRunId, {
    durationMs: params.agentDurationMs,
    summary: params.agentSummary,
    changedFiles: params.agentChangedFiles,
    prNumber: params.prUpsertData?.number,
    prUrl: params.prUpsertData?.url,
    branchName: params.branchName,
  })
  await notifyAgentVerify(params.taskId)
}

// ── PR creation or reuse ──────────────────────────────────────────────────

export async function createOrReusePR(
  ctx: RunContext,
  branchExistsOnRemote: boolean,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  const hasPR =
    ctx.isFollowUp && branchExistsOnRemote && ctx.task.pullRequests[0]
  return hasPR ? reuseExistingPR(ctx, runMeta) : createNewPR(ctx, runMeta)
}

export async function reuseExistingPR(
  ctx: RunContext,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  fireProgress(
    ctx.taskId,
    ctx.currentRunId,
    'pr',
    'Updating existing pull request...'
  )
  const { prUrl, prNumber } = await findExistingPR(ctx.taskId, ctx.resolvedRepo)

  await completeAgentRun({
    taskId: ctx.taskId,
    projectId: ctx.task.project.id,
    taskStatus: ctx.task.status,
    branchName: ctx.branchName,
    resolvedRepo: ctx.resolvedRepo,
    agentRunId: ctx.currentRunId,
    agentSummary: runMeta.summary,
    agentChangedFiles: runMeta.changedFiles,
    agentDurationMs: Date.now() - ctx.agentStartedAt,
  })
  return { prUrl, prNumber }
}

export function buildPRBody(taskSpec: string, identifier: string): string {
  return `## Summary\n\n${taskSpec}\n\n---\n_This PR was created by Lumo Agent_\n\nRelated task: ${identifier}`
}

export async function createNewPR(
  ctx: RunContext,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  fireProgress(ctx.taskId, ctx.currentRunId, 'pr', 'Creating pull request...')
  const prTitle = `${ctx.task.title} [${ctx.identifier}]`
  const pr = await createPullRequest({
    owner: ctx.repoOwner,
    repo: ctx.repoName,
    branch: ctx.branchName,
    title: prTitle,
    body: buildPRBody(ctx.taskSpec, ctx.identifier),
    token: ctx.githubToken,
  })

  await completeAgentRun({
    taskId: ctx.taskId,
    projectId: ctx.task.project.id,
    taskStatus: ctx.task.status,
    branchName: ctx.branchName,
    resolvedRepo: ctx.resolvedRepo,
    agentRunId: ctx.currentRunId,
    agentSummary: runMeta.summary,
    agentChangedFiles: runMeta.changedFiles,
    agentDurationMs: Date.now() - ctx.agentStartedAt,
    prUpsertData: {
      workspaceId: ctx.task.project.workspaceId,
      number: pr.number,
      title: prTitle,
      url: pr.html_url,
    },
  })
  return { prUrl: pr.html_url, prNumber: pr.number }
}
