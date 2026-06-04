import { logger } from '@/lib/logger'
import { pushAgentEvent, pushTaskEvent } from '@/lib/integrations/pusher'
import { transitionAgentStatus } from './state-machine'
import { markRunCompleted } from './run-lifecycle'
import { fireProgress } from './pipeline'
import {
  findExistingPR,
  collectRunMetadata,
  createOrReusePR,
} from './github-pr'
import type { AgentResult, RunContext, ChangedFile } from './execute'

// ── Post-execution: commits, push, PR ─────────────────────────────────────

export async function handleNoCommits(
  ctx: RunContext,
  isFollowUpWithRemote: boolean
): Promise<AgentResult> {
  if (isFollowUpWithRemote) return handleFollowUpNoChanges(ctx)

  await transitionAgentStatus(ctx.taskId, ctx.task.project.id, 'COMPLETED')
  await markRunCompleted(ctx.currentRunId, {
    durationMs: Date.now() - ctx.agentStartedAt,
  })
  await pushAgentEvent(ctx.taskId, {
    type: 'agent:failed',
    error:
      'Agent made no changes. Please add a spec or description to the task.',
  })
  return { outcome: 'no_changes' }
}

export async function handleFollowUpNoChanges(
  ctx: RunContext
): Promise<AgentResult> {
  const { prUrl, prNumber } = await findExistingPR(ctx.taskId, ctx.resolvedRepo)

  await transitionAgentStatus(ctx.taskId, ctx.task.project.id, 'COMPLETED')
  await markRunCompleted(ctx.currentRunId, {
    durationMs: Date.now() - ctx.agentStartedAt,
    prNumber,
    prUrl,
    branchName: ctx.branchName,
  })
  await pushAgentEvent(ctx.taskId, { type: 'agent:done', prUrl, prNumber })
  return { outcome: 'done', prUrl, prNumber }
}

// ── Post-agent pipeline ─────────────────────────────────────────────────

/**
 * Post-agent processing — no sandbox required.
 * Agent is responsible for pushing its branch. We use GitHub API to
 * verify the push, collect metadata, and create the PR.
 */
export async function processPostAgent(
  ctx: RunContext,
  branchExistsOnRemote: boolean
): Promise<AgentResult> {
  // Check if agent pushed the branch by querying GitHub
  fireProgress(ctx.taskId, ctx.currentRunId, 'verify', 'Verifying push...')
  const branchOnGitHub = await checkBranchOnGitHub(
    ctx.repoOwner,
    ctx.repoName,
    ctx.branchName,
    ctx.githubToken
  )

  if (!branchOnGitHub) {
    logger.warn(
      `[Agent] Branch ${ctx.branchName} not found on GitHub — agent may not have pushed`
    )
    return handleNoCommits(ctx, ctx.isFollowUp && branchExistsOnRemote)
  }

  fireProgress(
    ctx.taskId,
    ctx.currentRunId,
    'metadata',
    'Collecting run metadata...'
  )
  const runMeta = await collectRunMetadata(ctx)

  fireProgress(ctx.taskId, ctx.currentRunId, 'pr', 'Creating pull request...')
  const { prUrl, prNumber } = await createOrReusePR(
    ctx,
    branchExistsOnRemote,
    runMeta
  )

  await emitDoneEvents(ctx, prUrl, prNumber, runMeta)
  return { outcome: 'done', prUrl, prNumber }
}

export async function checkBranchOnGitHub(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches/${branch}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  ).catch(() => null)
  return res?.ok === true
}

export async function emitDoneEvents(
  ctx: RunContext,
  prUrl: string,
  prNumber: number,
  runMeta: { summary: string; changedFiles: ChangedFile[] }
) {
  await pushAgentEvent(ctx.taskId, {
    type: 'agent:done',
    prUrl,
    prNumber,
    summary: runMeta.summary,
    changedFiles: runMeta.changedFiles,
    durationMs: Date.now() - ctx.agentStartedAt,
  })
  await pushTaskEvent(ctx.taskId, {
    type: 'task:updated',
    fields: ['status', 'agentStatus', 'pullRequests', 'branches'],
  })
}
