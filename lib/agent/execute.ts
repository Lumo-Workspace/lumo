import { Sandbox } from '@e2b/code-interpreter'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getGithubInstallationToken } from '@/lib/github/auth'
import { monitorForClarify, checkForClarifyFile } from './clarify-monitor'
import { pushAgentEvent, pushTaskEvent } from '@/lib/pusher/server'
import { AgentError, userFriendlyError } from './errors'
import { generateSpecDraft } from './generate-spec'
import { transitionAgentStatus } from './state-machine'
import {
  transitionTaskStatus,
  type TaskStatusValue,
} from '@/lib/task/state-machine'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { DomainEvent } from '@/lib/events/types'
import {
  notifyAgentVerify,
  notifyAgentFailed,
} from '@/lib/notifications/notifyAgentActions'
import { htmlToMarkdown } from './markdown'

// ── Constants ──────────────────────────────────────────────────────────────

const AGENT_TIMEOUT_MS = 28 * 60 * 1000
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000
const CLONE_TIMEOUT_MS = 2 * 60 * 1000
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000
const AGENT_CMD_TIMEOUT_MS = 25 * 60 * 1000
const PUSH_TIMEOUT_MS = 60 * 1000

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentResult =
  | { outcome: 'done'; prUrl: string; prNumber: number }
  | { outcome: 'failed'; error: string }
  | { outcome: 'clarify'; question: string }
  | { outcome: 'no_changes' }
  | { outcome: 'spec_review' }

export interface ExecuteAgentOptions {
  taskId: string
  actorClerkId: string
  actorName?: string
  actorEmail?: string
  trigger?: string
}

/** Bundled context passed between execution phases. */
interface RunContext {
  taskId: string
  task: Awaited<ReturnType<typeof loadTask>>
  identifier: string
  branchName: string
  isFollowUp: boolean
  taskSpec: string
  repoOwner: string
  repoName: string
  resolvedRepo: string
  githubToken: string
  anthropicKey: string
  currentRunId: string
  agentStartedAt: number
  gitName: string
  gitEmail: string
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

function summarizeToolInput(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, string>
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return i.file_path ?? ''
    case 'Bash':
      return (i.command ?? '').slice(0, 80)
    default:
      return ''
  }
}

// ── Data access ───────────────────────────────────────────────────────────

async function loadTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      repository: { select: { fullName: true } },
      branches: {
        select: { branchName: true },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
      },
      pullRequests: {
        where: { state: 'open' },
        select: { headBranch: true, url: true, number: true },
        take: 1,
      },
      project: {
        select: {
          id: true,
          name: true,
          workspaceId: true,
          defaultReviewerId: true,
          repositories: {
            where: { isDefault: true },
            select: { fullName: true },
            take: 1,
          },
        },
      },
    },
  })
  if (!task) throw new Error(`Task ${taskId} not found`)
  return task
}

async function nextRunNumber(taskId: string): Promise<number> {
  const last = await prisma.agentRun.findFirst({
    where: { taskId },
    orderBy: { runNumber: 'desc' },
    select: { runNumber: true },
  })
  return (last?.runNumber ?? 0) + 1
}

// ── Resolution helpers ────────────────────────────────────────────────────

function resolveRepo(task: Awaited<ReturnType<typeof loadTask>>): string {
  const repo =
    task.repository?.fullName ?? task.project.repositories[0]?.fullName
  if (!repo) throw new Error(`Task ${task.id} has no GitHub repo configured`)
  return repo
}

function resolveBranch(
  task: Awaited<ReturnType<typeof loadTask>>,
  identifier: string
): { branchName: string; isFollowUp: boolean } {
  const existing =
    task.pullRequests[0]?.headBranch ?? task.branches[0]?.branchName ?? null
  return {
    branchName: existing ?? `lumo/${identifier}-${slugify(task.title)}`,
    isFollowUp: !!existing,
  }
}

// ── Status transitions ────────────────────────────────────────────────────

async function markFailed(
  taskId: string,
  projectId: string,
  code: string,
  message: string,
  agentRunId?: string
) {
  await transitionAgentStatus(taskId, projectId, 'FAILED', {
    agentError: code,
  })
  await pushAgentEvent(taskId, {
    type: 'agent:failed',
    error: userFriendlyError(code),
  })
  await notifyAgentFailed(taskId)
  if (agentRunId) {
    await prisma.agentRun.update({
      where: { id: agentRunId },
      data: {
        status: 'FAILED',
        errorCode: code,
        errorMessage: userFriendlyError(code),
        finishedAt: new Date(),
      },
    })
  }
  console.error(`[Agent] Task ${taskId} failed [${code}]: ${message}`)
}

async function markRunCompleted(
  runId: string,
  data: {
    durationMs: number
    prNumber?: number | undefined
    prUrl?: string | undefined
    branchName?: string | undefined
    summary?: string | null | undefined
    changedFiles?: unknown
  }
) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: 'COMPLETED',
      summary: (data.summary as string) ?? null,
      changedFiles:
        (data.changedFiles as Prisma.InputJsonValue) ?? Prisma.DbNull,
      durationMs: data.durationMs,
      prNumber: data.prNumber ?? null,
      prUrl: data.prUrl ?? null,
      branchName: data.branchName ?? null,
      finishedAt: new Date(),
    },
  })
}

// ── GitHub helpers ─────────────────────────────────────────────────────────

async function createPullRequest(params: {
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

// ── Sandbox setup ─────────────────────────────────────────────────────────

async function createSandbox(runId: string): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    timeoutMs: SANDBOX_TIMEOUT_MS,
  }).catch(err => {
    throw new AgentError(
      'SANDBOX_CREATE_FAILED',
      'Failed to create sandbox',
      err
    )
  })
  await prisma.agentRun.update({
    where: { id: runId },
    data: { sandboxId: sandbox.sandboxId },
  })
  return sandbox
}

async function cloneRepo(
  sandbox: Sandbox,
  ctx: Pick<
    RunContext,
    'taskId' | 'repoOwner' | 'repoName' | 'githubToken' | 'gitName' | 'gitEmail'
  >
) {
  await pushAgentEvent(ctx.taskId, {
    type: 'agent:progress',
    message: `Cloning ${ctx.repoOwner}/${ctx.repoName}...`,
  })
  const clone = await sandbox.commands
    .run(
      `git clone https://oauth2:${ctx.githubToken}@github.com/${ctx.repoOwner}/${ctx.repoName} /home/user/repo` +
        ` && git -C /home/user/repo config user.email "${ctx.gitEmail}"` +
        ` && git -C /home/user/repo config user.name "${ctx.gitName}"`,
      { timeoutMs: CLONE_TIMEOUT_MS }
    )
    .catch(err => {
      throw new AgentError('CLONE_FAILED', 'Failed to clone repository', err)
    })
  if (clone.exitCode !== 0) {
    throw new AgentError('CLONE_FAILED', `Git clone failed: ${clone.stderr}`)
  }
}

async function installClaude(sandbox: Sandbox, taskId: string) {
  await pushAgentEvent(taskId, {
    type: 'agent:progress',
    message: 'Setting up environment...',
  })
  await sandbox.commands.run('sudo npm install -g @anthropic-ai/claude-code', {
    timeoutMs: INSTALL_TIMEOUT_MS,
  })
}

async function checkoutBranch(
  sandbox: Sandbox,
  ctx: Pick<RunContext, 'taskId' | 'branchName' | 'isFollowUp'>
): Promise<boolean> {
  let branchExistsOnRemote = false
  if (ctx.isFollowUp) {
    const lsRemote = await sandbox.commands
      .run(
        `git -C /home/user/repo ls-remote --heads origin ${ctx.branchName}`,
        { timeoutMs: 30 * 1000 }
      )
      .catch(() => ({ stdout: '' }))
    branchExistsOnRemote = !!(lsRemote.stdout && lsRemote.stdout.trim())
  }

  if (branchExistsOnRemote) {
    await pushAgentEvent(ctx.taskId, {
      type: 'agent:progress',
      message: `Checking out existing branch ${ctx.branchName}...`,
    })
    await sandbox.commands.run(
      `git -C /home/user/repo fetch origin ${ctx.branchName} && git -C /home/user/repo checkout ${ctx.branchName}`,
      { timeoutMs: PUSH_TIMEOUT_MS }
    )
  } else {
    await pushAgentEvent(ctx.taskId, {
      type: 'agent:progress',
      message: `Creating branch ${ctx.branchName}...`,
    })
    await sandbox.commands.run(
      `git -C /home/user/repo checkout -b ${ctx.branchName}`
    )
  }

  return branchExistsOnRemote
}

// ── Task spec ─────────────────────────────────────────────────────────────

function buildTaskSpecContent(
  title: string,
  identifier: string,
  taskSpec: string,
  branchName: string
): string {
  return `# Task: ${title}
Task ID: ${identifier}

${taskSpec}

## Instructions
- Read CLAUDE.md first for project conventions
- Branch is already created: ${branchName}
- Commit your changes when done; include [${identifier}] in the commit message
- Do NOT add Co-Authored-By or any AI attribution lines to commit messages
- Do NOT push; do NOT create a PR (handled automatically)

## Clarification Protocol
If the spec is ambiguous, missing critical details, or you are unsure how to proceed,
you MUST ask for clarification instead of guessing. To do so:
1. Use the Write tool to create \`/tmp/clarify-question.txt\` with this exact JSON format:
   {"question":"Your specific question here","context":"What you were doing when you got stuck"}
2. After writing the file, STOP immediately. Do not continue working. Output a short
   message like "I've requested clarification and stopped." then produce no more tool calls.
The system will deliver your question to the assignee and restart you with the answer.`
}

async function writeTaskSpec(sandbox: Sandbox, ctx: RunContext) {
  const content = buildTaskSpecContent(
    ctx.task.title,
    ctx.identifier,
    ctx.taskSpec,
    ctx.branchName
  )
  await sandbox.files.write('/home/user/task.md', content)
}

// ── Agent execution ───────────────────────────────────────────────────────

function buildClaudeCommand(anthropicKey: string): string {
  const tools =
    'Read,Write,Edit,' +
    'Bash(git add *),Bash(git commit *),Bash(npm *),Bash(npx *),' +
    'Bash(ls *),Bash(cat *),Bash(mkdir *)'
  return (
    `cd /home/user/repo && ANTHROPIC_API_KEY=${anthropicKey} ` +
    `claude -p "$(cat /home/user/task.md)" ` +
    `--allowedTools "${tools}" ` +
    `--output-format stream-json --verbose --bare --max-turns 50`
  )
}

function createStdoutHandler(taskId: string) {
  return async (data: string) => {
    try {
      const msg = JSON.parse(data)
      if (msg.type !== 'assistant') return
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) {
          await pushAgentEvent(taskId, {
            type: 'agent:thinking',
            message: (block.text as string).slice(0, 120),
          })
        }
        if (block.type === 'tool_use') {
          await pushAgentEvent(taskId, {
            type: 'agent:tool',
            tool: block.name as string,
            input: summarizeToolInput(block.name as string, block.input),
          })
        }
      }
    } catch {
      // Not JSON — skip
    }
  }
}

async function runClaudeWithMonitor(
  sandbox: Sandbox,
  ctx: RunContext
): Promise<AgentResult | 'agent_done'> {
  const monitorTask = {
    id: ctx.taskId,
    identifier: ctx.identifier,
    reviewerId: '',
    projectId: ctx.task.project.id,
  }

  const CLARIFY_SENTINEL = '__clarify__'
  const clarifyHandle = monitorForClarify(sandbox, monitorTask)

  try {
    await pushAgentEvent(ctx.taskId, {
      type: 'agent:progress',
      message: 'Agent is analyzing the codebase...',
    })

    const winner = await Promise.race([
      sandbox.commands
        .run(buildClaudeCommand(ctx.anthropicKey), {
          timeoutMs: AGENT_CMD_TIMEOUT_MS,
          onStdout: createStdoutHandler(ctx.taskId),
        })
        .catch(err => {
          throw new AgentError(
            'AGENT_EXECUTION_FAILED',
            'Agent execution failed',
            err
          )
        }),
      clarifyHandle.promise.then(() => CLARIFY_SENTINEL),
    ])

    clarifyHandle.stop()

    if (winner === CLARIFY_SENTINEL) {
      return finalizeClarify(ctx.taskId, ctx.currentRunId)
    }

    // Fallback: agent exited before monitor polled
    if (await checkForClarifyFile(sandbox, monitorTask)) {
      return finalizeClarify(ctx.taskId, ctx.currentRunId)
    }

    const result = winner as Awaited<ReturnType<typeof sandbox.commands.run>>
    if (result.exitCode !== 0) {
      throw new AgentError(
        'AGENT_EXECUTION_FAILED',
        `Agent exited with code ${result.exitCode}: ${result.stderr}`
      )
    }

    return 'agent_done'
  } finally {
    clarifyHandle.stop()
  }
}

async function finalizeClarify(
  taskId: string,
  runId: string
): Promise<AgentResult> {
  await prisma.agentClarify.updateMany({
    where: { taskId, agentRunId: null },
    data: { agentRunId: runId },
  })
  const clarify = await prisma.agentClarify.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  })
  await pushAgentEvent(taskId, {
    type: 'agent:clarify',
    question: clarify?.question ?? '',
    context: clarify?.context ?? null,
  })
  return { outcome: 'clarify', question: clarify?.question ?? '' }
}

// ── Post-execution: commits, push, PR ─────────────────────────────────────

async function checkForCommits(
  sandbox: Sandbox,
  branchName: string,
  diffBase: string
): Promise<boolean> {
  const commitCheck = await sandbox.commands.run(
    `git -C /home/user/repo log --oneline ${diffBase}..${branchName} 2>/dev/null | head -1`
  )
  return !!commitCheck.stdout.trim()
}

function getDiffBase(
  isFollowUp: boolean,
  branchExistsOnRemote: boolean,
  branchName: string
): string {
  return isFollowUp && branchExistsOnRemote
    ? `origin/${branchName}`
    : 'origin/HEAD'
}

async function handleNoCommits(
  ctx: RunContext,
  isFollowUpWithRemote: boolean
): Promise<AgentResult> {
  if (isFollowUpWithRemote) {
    return handleFollowUpNoChanges(ctx)
  }
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

async function handleFollowUpNoChanges(ctx: RunContext): Promise<AgentResult> {
  const existingPr = await prisma.pullRequest.findFirst({
    where: { taskId: ctx.taskId, state: 'open' },
    select: { url: true, number: true },
  })
  const prUrl =
    existingPr?.url ?? `https://github.com/${ctx.resolvedRepo}/pulls`
  const prNumber = existingPr?.number ?? 0

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

async function pushBranch(
  sandbox: Sandbox,
  taskId: string,
  branchName: string
) {
  await pushAgentEvent(taskId, {
    type: 'agent:progress',
    message: 'Pushing branch...',
  })
  const push = await sandbox.commands
    .run(`git -C /home/user/repo push origin ${branchName}`, {
      timeoutMs: PUSH_TIMEOUT_MS,
    })
    .catch(err => {
      throw new AgentError('PUSH_FAILED', 'Failed to push branch', err)
    })
  if (push.exitCode !== 0) {
    throw new AgentError('PUSH_FAILED', `Git push failed: ${push.stderr}`)
  }
}

async function collectRunMetadata(
  sandbox: Sandbox,
  diffBase: string,
  branchName: string
): Promise<{
  changedFiles: { path: string; status: 'added' | 'modified' | 'deleted' }[]
  summary: string
}> {
  const changedFiles = await collectChangedFiles(sandbox, diffBase, branchName)
  const summary = await collectCommitSummary(sandbox, diffBase, branchName)
  return { changedFiles, summary }
}

async function collectChangedFiles(
  sandbox: Sandbox,
  diffBase: string,
  branchName: string
) {
  const STATUS_MAP: Record<string, 'added' | 'modified' | 'deleted'> = {
    A: 'added',
    M: 'modified',
    D: 'deleted',
  }
  const diffResult = await sandbox.commands
    .run(
      `git -C /home/user/repo diff --name-status ${diffBase}..${branchName} 2>/dev/null`
    )
    .catch(() => ({ stdout: '' }))
  return (diffResult.stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [statusChar, ...pathParts] = line.split('\t')
      return {
        path: pathParts.join('\t'),
        status: STATUS_MAP[statusChar?.charAt(0) ?? ''] ?? 'modified',
      }
    })
    .filter(f => f.path)
}

async function collectCommitSummary(
  sandbox: Sandbox,
  diffBase: string,
  branchName: string
): Promise<string> {
  const logResult = await sandbox.commands
    .run(
      `git -C /home/user/repo log --format=%s ${diffBase}..${branchName} 2>/dev/null`
    )
    .catch(() => ({ stdout: '' }))
  const commits = (logResult.stdout ?? '').split('\n').filter(Boolean)
  if (commits.length === 1) return commits[0]!
  if (commits.length > 1) return commits.join('; ')
  return 'Agent completed successfully'
}

// ── Complete agent run ────────────────────────────────────────────────────

async function completeAgentRun(params: {
  taskId: string
  projectId: string
  taskStatus: string
  branchName: string
  resolvedRepo: string
  agentRunId: string
  agentSummary?: string | null
  agentChangedFiles?: {
    path: string
    status: 'added' | 'modified' | 'deleted'
  }[]
  agentDurationMs: number
  prUpsertData?: {
    workspaceId: string
    number: number
    title: string
    url: string
  }
}): Promise<void> {
  const events = await transitionWithTaskStatus(params)
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

async function transitionWithTaskStatus(params: {
  taskId: string
  projectId: string
  taskStatus: string
}): Promise<DomainEvent[]> {
  const agentEvents = await transitionAgentStatus(
    params.taskId,
    params.projectId,
    'COMPLETED',
    { skipDispatch: true }
  )
  let taskEvents: DomainEvent[] = []
  try {
    taskEvents = await transitionTaskStatus(
      params.taskId,
      params.projectId,
      'IN_REVIEW',
      {
        currentStatus: params.taskStatus as TaskStatusValue,
        skipDispatch: true,
      }
    )
  } catch {
    console.warn(
      `[Agent] Skipping task status → IN_REVIEW: invalid from ${params.taskStatus}`
    )
  }
  return [...agentEvents, ...taskEvents]
}

async function upsertBranchAndPR(params: {
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
  const branchUpsert = prisma.taskBranch.upsert({
    where: {
      taskId_repo_branchName: {
        taskId: params.taskId,
        repo: params.resolvedRepo,
        branchName: params.branchName,
      },
    },
    create: {
      taskId: params.taskId,
      repo: params.resolvedRepo,
      branchName: params.branchName,
    },
    update: {},
  })

  if (params.prUpsertData) {
    const { workspaceId, number, title, url } = params.prUpsertData
    await prisma.$transaction([
      branchUpsert,
      prisma.pullRequest.upsert({
        where: { repo_number: { repo: params.resolvedRepo, number } },
        create: {
          workspaceId,
          taskId: params.taskId,
          repo: params.resolvedRepo,
          number,
          title,
          url,
          state: 'open',
          authorLogin: 'lumo-agent',
          headBranch: params.branchName,
          baseBranch: 'main',
        },
        update: { state: 'open', url, taskId: params.taskId },
      }),
    ])
  } else {
    await branchUpsert
  }
}

// ── PR creation or reuse ──────────────────────────────────────────────────

async function createOrReusePR(
  ctx: RunContext,
  branchExistsOnRemote: boolean,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  const hasPR =
    ctx.isFollowUp && branchExistsOnRemote && ctx.task.pullRequests[0]
  if (hasPR) {
    return reuseExistingPR(ctx, runMeta)
  }
  return createNewPR(ctx, runMeta)
}

async function reuseExistingPR(
  ctx: RunContext,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  await pushAgentEvent(ctx.taskId, {
    type: 'agent:progress',
    message: 'Updating existing pull request...',
  })
  const existingPr = await prisma.pullRequest.findFirst({
    where: { taskId: ctx.taskId, state: 'open' },
    select: { url: true, number: true },
  })
  const prUrl =
    existingPr?.url ?? `https://github.com/${ctx.resolvedRepo}/pulls`
  const prNumber = existingPr?.number ?? 0

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

async function createNewPR(
  ctx: RunContext,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  await pushAgentEvent(ctx.taskId, {
    type: 'agent:progress',
    message: 'Creating pull request...',
  })
  const pr = await createPullRequest({
    owner: ctx.repoOwner,
    repo: ctx.repoName,
    branch: ctx.branchName,
    title: `${ctx.task.title} [${ctx.identifier}]`,
    body: `## Summary\n\n${ctx.taskSpec}\n\n---\n_This PR was created by Lumo Agent_\n\nRelated task: ${ctx.identifier}`,
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
      title: `${ctx.task.title} [${ctx.identifier}]`,
      url: pr.html_url,
    },
  })

  return { prUrl: pr.html_url, prNumber: pr.number }
}

// ── Error handling ────────────────────────────────────────────────────────

async function handleExecutionError(
  error: unknown,
  ctx: RunContext
): Promise<AgentResult> {
  const current = await prisma.task.findUnique({
    where: { id: ctx.taskId },
    select: { agentStatus: true },
  })

  if (
    current?.agentStatus === 'INPUT_REQUIRED' ||
    current?.agentStatus === 'CANCELED'
  ) {
    if (current.agentStatus === 'CANCELED') {
      await prisma.agentRun.update({
        where: { id: ctx.currentRunId },
        data: { status: 'CANCELED', finishedAt: new Date() },
      })
    }
    return { outcome: 'failed', error: `Agent ${current.agentStatus}` }
  }

  if (error instanceof AgentError) {
    await markFailed(
      ctx.taskId,
      ctx.task.project.id,
      error.code,
      error.message,
      ctx.currentRunId
    )
    return { outcome: 'failed', error: userFriendlyError(error.code) }
  }

  const message = error instanceof Error ? error.message : 'Unknown error'
  await markFailed(
    ctx.taskId,
    ctx.task.project.id,
    'UNKNOWN_ERROR',
    message,
    ctx.currentRunId
  )
  return { outcome: 'failed', error: userFriendlyError('UNKNOWN_ERROR') }
}

// ── Main orchestrator ─────────────────────────────────────────────────────

export async function executeAgent({
  taskId,
  actorName,
  actorEmail,
  trigger,
}: ExecuteAgentOptions): Promise<AgentResult> {
  const task = await loadTask(taskId)

  // If no spec yet, generate one and pause for review
  if (!task.spec?.trim()) {
    await generateSpecDraft(taskId, {
      title: task.title,
      description: task.description,
      spec: task.spec,
      project: { id: task.project.id },
    })
    return { outcome: 'spec_review' } as AgentResult
  }

  const ctx = await buildRunContext(task, {
    taskId,
    actorName,
    actorEmail,
    trigger,
  })

  let sandbox: Sandbox | undefined
  let timedOut = false

  const timeoutHandle = setTimeout(async () => {
    timedOut = true
    await markFailed(
      taskId,
      task.project.id,
      'TIMEOUT',
      'Agent timed out after 28 minutes',
      ctx.currentRunId
    )
    if (sandbox) await sandbox.kill().catch(() => {})
  }, AGENT_TIMEOUT_MS)

  try {
    sandbox = await createSandbox(ctx.currentRunId)
    await cloneRepo(sandbox, ctx)
    await installClaude(sandbox, taskId)
    const branchExistsOnRemote = await checkoutBranch(sandbox, ctx)
    await writeTaskSpec(sandbox, ctx)

    const agentResult = await runClaudeWithMonitor(sandbox, ctx)
    if (timedOut) return { outcome: 'failed', error: 'Agent timed out' }
    if (agentResult !== 'agent_done') return agentResult

    const diffBase = getDiffBase(
      ctx.isFollowUp,
      branchExistsOnRemote,
      ctx.branchName
    )
    const hasCommits = await checkForCommits(sandbox, ctx.branchName, diffBase)
    if (!hasCommits) {
      return handleNoCommits(ctx, ctx.isFollowUp && branchExistsOnRemote)
    }

    await pushBranch(sandbox, taskId, ctx.branchName)
    const runMeta = await collectRunMetadata(sandbox, diffBase, ctx.branchName)
    const { prUrl, prNumber } = await createOrReusePR(
      ctx,
      branchExistsOnRemote,
      runMeta
    )

    await pushAgentEvent(taskId, {
      type: 'agent:done',
      prUrl,
      prNumber,
      summary: runMeta.summary,
      changedFiles: runMeta.changedFiles,
      durationMs: Date.now() - ctx.agentStartedAt,
    })
    await pushTaskEvent(taskId, {
      type: 'task:updated',
      fields: ['status', 'agentStatus', 'pullRequests', 'branches'],
    })

    return { outcome: 'done', prUrl, prNumber }
  } catch (error) {
    if (timedOut) return { outcome: 'failed', error: 'Agent timed out' }
    return handleExecutionError(error, ctx)
  } finally {
    clearTimeout(timeoutHandle)
    if (sandbox) await sandbox.kill().catch(() => {})
  }
}

async function buildRunContext(
  task: Awaited<ReturnType<typeof loadTask>>,
  opts: {
    taskId: string
    actorName?: string | undefined
    actorEmail?: string | undefined
    trigger?: string | undefined
  }
): Promise<RunContext> {
  const resolvedRepo = resolveRepo(task)
  const [repoOwner, repoName] = resolvedRepo.split('/')
  if (!repoOwner || !repoName)
    throw new Error(`Invalid repo format: ${resolvedRepo}`)

  const identifier = `LUM-${task.number}`
  const { branchName, isFollowUp } = resolveBranch(task, identifier)
  const rawSpec = task.spec ?? task.description ?? task.title
  const taskSpec = htmlToMarkdown(rawSpec)

  const githubToken = await getGithubInstallationToken().catch(err => {
    throw new AgentError('CLONE_FAILED', 'Failed to get GitHub token', err)
  })
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const runNumber = await nextRunNumber(opts.taskId)
  const agentRun = await prisma.agentRun.create({
    data: {
      taskId: opts.taskId,
      runNumber,
      status: 'WORKING',
      trigger: opts.trigger ?? 'initial',
    },
  })

  await transitionAgentStatus(opts.taskId, task.project.id, 'WORKING', {
    agentError: null,
  })
  await pushAgentEvent(opts.taskId, { type: 'agent:started' })

  return {
    taskId: opts.taskId,
    task,
    identifier,
    branchName,
    isFollowUp,
    taskSpec,
    repoOwner,
    repoName,
    resolvedRepo,
    githubToken,
    anthropicKey,
    currentRunId: agentRun.id,
    agentStartedAt: Date.now(),
    gitName: opts.actorName
      ? `${opts.actorName} (via Lumo Agent)`
      : 'Lumo Agent',
    gitEmail: opts.actorEmail || 'agent@uselumo.ai',
  }
}
