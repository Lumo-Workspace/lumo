import { Sandbox } from '@e2b/code-interpreter'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getGithubInstallationToken } from '@/lib/github/auth'
// clarify-monitor removed — MCP server now communicates via HTTP API
import {
  pushAgentEvent,
  fireAgentEvent,
  pushTaskEvent,
} from '@/lib/pusher/server'
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
import { installMcpServer, MCP_CONFIG_PATH } from './sandbox-mcp'

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

type ChangedFile = { path: string; status: 'added' | 'modified' | 'deleted' }

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
  if (tool === 'Read' || tool === 'Write' || tool === 'Edit')
    return i.file_path ?? ''
  if (tool === 'Bash') return (i.command ?? '').slice(0, 80)
  return ''
}

const STATUS_MAP: Record<string, ChangedFile['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
}

function parseGitDiffLine(line: string): ChangedFile | null {
  const [statusChar, ...pathParts] = line.split('\t')
  const path = pathParts.join('\t')
  if (!path) return null
  return { path, status: STATUS_MAP[statusChar?.charAt(0) ?? ''] ?? 'modified' }
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

function resolveGitIdentity(actorName?: string, actorEmail?: string) {
  return {
    gitName: actorName ? `${actorName} (via Lumo Agent)` : 'Lumo Agent',
    gitEmail: actorEmail || 'agent@uselumo.ai',
  }
}

async function resolveCredentials(): Promise<{
  githubToken: string
  anthropicKey: string
}> {
  const githubToken = await getGithubInstallationToken().catch(err => {
    throw new AgentError('CLONE_FAILED', 'Failed to get GitHub token', err)
  })
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')
  return { githubToken, anthropicKey }
}

// ── AgentRun lifecycle ───────────────────────────────────────────────────

async function createAgentRun(
  taskId: string,
  projectId: string,
  trigger: string
): Promise<string> {
  const runNumber = await nextRunNumber(taskId)
  const agentRun = await prisma.agentRun.create({
    data: { taskId, runNumber, status: 'WORKING', trigger },
  })
  await transitionAgentStatus(taskId, projectId, 'WORKING', {
    agentError: null,
  })
  fireAgentEvent(taskId, { type: 'agent:started' })
  return agentRun.id
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

async function updateFailedRun(agentRunId: string, code: string) {
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
  if (agentRunId) await updateFailedRun(agentRunId, code)
  console.error(`[Agent] Task ${taskId} failed [${code}]: ${message}`)
}

async function markRunCanceled(runId: string) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: 'CANCELED', finishedAt: new Date() },
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

function buildCloneCommand(
  ctx: Pick<
    RunContext,
    'repoOwner' | 'repoName' | 'githubToken' | 'gitEmail' | 'gitName'
  >
) {
  return (
    `git clone https://oauth2:${ctx.githubToken}@github.com/${ctx.repoOwner}/${ctx.repoName} /home/user/repo` +
    ` && git -C /home/user/repo config user.email "${ctx.gitEmail}"` +
    ` && git -C /home/user/repo config user.name "${ctx.gitName}"`
  )
}

async function cloneRepo(
  sandbox: Sandbox,
  ctx: Pick<
    RunContext,
    'taskId' | 'repoOwner' | 'repoName' | 'githubToken' | 'gitName' | 'gitEmail'
  >
) {
  fireAgentEvent(ctx.taskId, {
    type: 'agent:progress',
    message: `Cloning ${ctx.repoOwner}/${ctx.repoName}...`,
  })
  const clone = await sandbox.commands
    .run(buildCloneCommand(ctx), { timeoutMs: CLONE_TIMEOUT_MS })
    .catch(err => {
      throw new AgentError('CLONE_FAILED', 'Failed to clone repository', err)
    })
  if (clone.exitCode !== 0) {
    throw new AgentError('CLONE_FAILED', `Git clone failed: ${clone.stderr}`)
  }
}

async function installClaude(sandbox: Sandbox, taskId: string) {
  fireAgentEvent(taskId, {
    type: 'agent:progress',
    message: 'Setting up environment...',
  })
  await sandbox.commands.run('sudo npm install -g @anthropic-ai/claude-code', {
    timeoutMs: INSTALL_TIMEOUT_MS,
  })
}

// ── Branch operations ────────────────────────────────────────────────────

async function checkRemoteBranchExists(
  sandbox: Sandbox,
  branchName: string
): Promise<boolean> {
  const lsRemote = await sandbox.commands
    .run(`git -C /home/user/repo ls-remote --heads origin ${branchName}`, {
      timeoutMs: 30 * 1000,
    })
    .catch(() => ({ stdout: '' }))
  return !!(lsRemote.stdout && lsRemote.stdout.trim())
}

async function fetchAndCheckout(
  sandbox: Sandbox,
  taskId: string,
  branchName: string
) {
  fireAgentEvent(taskId, {
    type: 'agent:progress',
    message: `Checking out existing branch ${branchName}...`,
  })
  await sandbox.commands.run(
    `git -C /home/user/repo fetch origin ${branchName} && git -C /home/user/repo checkout ${branchName}`,
    { timeoutMs: PUSH_TIMEOUT_MS }
  )
}

async function createBranch(
  sandbox: Sandbox,
  taskId: string,
  branchName: string
) {
  fireAgentEvent(taskId, {
    type: 'agent:progress',
    message: `Creating branch ${branchName}...`,
  })
  await sandbox.commands.run(`git -C /home/user/repo checkout -b ${branchName}`)
}

async function checkoutBranch(
  sandbox: Sandbox,
  ctx: Pick<RunContext, 'taskId' | 'branchName' | 'isFollowUp'>
): Promise<boolean> {
  const branchExistsOnRemote =
    ctx.isFollowUp && (await checkRemoteBranchExists(sandbox, ctx.branchName))

  if (branchExistsOnRemote) {
    await fetchAndCheckout(sandbox, ctx.taskId, ctx.branchName)
  } else {
    await createBranch(sandbox, ctx.taskId, ctx.branchName)
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
- Call the \`mcp__lumo-sandbox__ask_user\` tool with your question and context.
  IMPORTANT: Use exactly this tool name — do NOT use AskUserQuestion or any other tool.
- The tool will BLOCK and wait for the user's reply (this may take minutes).
- Once you receive the reply, continue working based on the answer.
- Do NOT stop or exit after calling mcp__lumo-sandbox__ask_user — just wait for the response.`
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
    'Bash(ls *),Bash(cat *),Bash(mkdir *),' +
    'mcp__lumo-sandbox__ask_user,mcp__lumo-sandbox__report_progress'
  return (
    `cd /home/user/repo && ANTHROPIC_API_KEY=${anthropicKey} ` +
    `claude -p "$(cat /home/user/task.md)" ` +
    `--allowedTools "${tools}" ` +
    `--mcp-config ${MCP_CONFIG_PATH} ` +
    `--output-format stream-json --verbose --max-turns 50`
  )
}

function processContentBlock(
  taskId: string,
  block: { type: string; text?: string; name?: string; input?: unknown }
) {
  if (block.type === 'text' && block.text?.trim()) {
    fireAgentEvent(taskId, {
      type: 'agent:thinking',
      message: (block.text as string).slice(0, 120),
    })
  } else if (block.type === 'tool_use') {
    fireAgentEvent(taskId, {
      type: 'agent:tool',
      tool: block.name as string,
      input: summarizeToolInput(block.name as string, block.input),
    })
  }
}

function createStdoutHandler(taskId: string) {
  return (data: string) => {
    try {
      const msg = JSON.parse(data)
      if (msg.type !== 'assistant') return
      for (const block of msg.message?.content ?? []) {
        processContentBlock(taskId, block)
      }
    } catch {
      // Not JSON — skip
    }
  }
}

/**
 * Run the Claude agent command in the sandbox.
 *
 * With the HTTP-based MCP flow, the agent stays alive when `ask_user` is
 * called (the MCP server blocks on HTTP polling). The command only exits
 * when the agent is truly done or timed out. The `INPUT_REQUIRED` status
 * transition is handled by `POST /api/agent/mcp-clarify`.
 */
async function runClaude(
  sandbox: Sandbox,
  ctx: RunContext
): Promise<AgentResult | 'agent_done'> {
  fireAgentEvent(ctx.taskId, {
    type: 'agent:progress',
    message: 'Agent is analyzing the codebase...',
  })

  const result = await sandbox.commands
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
    })

  // After agent exits, check if there's a pending clarify in the DB
  // (created by the HTTP callback from the MCP server)
  const pendingClarify = await prisma.agentClarify.findFirst({
    where: { taskId: ctx.taskId, reply: null },
    orderBy: { createdAt: 'desc' },
  })

  if (pendingClarify) {
    return finalizeClarify(ctx.taskId, ctx.currentRunId)
  }

  if (result.exitCode !== 0) {
    throw new AgentError(
      'AGENT_EXECUTION_FAILED',
      `Agent exited with code ${result.exitCode}: ${result.stderr}`
    )
  }

  return 'agent_done'
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

async function handleNoCommits(
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

async function findExistingPR(taskId: string, fallbackRepo: string) {
  const existingPr = await prisma.pullRequest.findFirst({
    where: { taskId, state: 'open' },
    select: { url: true, number: true },
  })
  return {
    prUrl: existingPr?.url ?? `https://github.com/${fallbackRepo}/pulls`,
    prNumber: existingPr?.number ?? 0,
  }
}

async function handleFollowUpNoChanges(ctx: RunContext): Promise<AgentResult> {
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

async function pushBranch(
  sandbox: Sandbox,
  taskId: string,
  branchName: string
) {
  fireAgentEvent(taskId, {
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

// ── Run metadata collection ──────────────────────────────────────────────

async function collectChangedFiles(
  sandbox: Sandbox,
  diffBase: string,
  branchName: string
): Promise<ChangedFile[]> {
  const diffResult = await sandbox.commands
    .run(
      `git -C /home/user/repo diff --name-status ${diffBase}..${branchName} 2>/dev/null`
    )
    .catch(() => ({ stdout: '' }))
  return (diffResult.stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .map(parseGitDiffLine)
    .filter((f): f is ChangedFile => f !== null)
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

async function collectRunMetadata(
  sandbox: Sandbox,
  diffBase: string,
  branchName: string
) {
  const changedFiles = await collectChangedFiles(sandbox, diffBase, branchName)
  const summary = await collectCommitSummary(sandbox, diffBase, branchName)
  return { changedFiles, summary }
}

// ── Complete agent run ────────────────────────────────────────────────────

async function transitionStatuses(
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

async function tryTransitionTaskStatus(
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

async function completeAgentRun(params: {
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

// ── Branch & PR upsert ──────────────────────────────────────────────────

function buildBranchUpsert(
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

function buildPRUpsert(
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

// ── PR creation or reuse ──────────────────────────────────────────────────

async function createOrReusePR(
  ctx: RunContext,
  branchExistsOnRemote: boolean,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  const hasPR =
    ctx.isFollowUp && branchExistsOnRemote && ctx.task.pullRequests[0]
  return hasPR ? reuseExistingPR(ctx, runMeta) : createNewPR(ctx, runMeta)
}

async function reuseExistingPR(
  ctx: RunContext,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  fireAgentEvent(ctx.taskId, {
    type: 'agent:progress',
    message: 'Updating existing pull request...',
  })
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

function buildPRBody(taskSpec: string, identifier: string): string {
  return `## Summary\n\n${taskSpec}\n\n---\n_This PR was created by Lumo Agent_\n\nRelated task: ${identifier}`
}

async function createNewPR(
  ctx: RunContext,
  runMeta: Awaited<ReturnType<typeof collectRunMetadata>>
): Promise<{ prUrl: string; prNumber: number }> {
  fireAgentEvent(ctx.taskId, {
    type: 'agent:progress',
    message: 'Creating pull request...',
  })
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

// ── Error handling ────────────────────────────────────────────────────────

async function checkCurrentStatus(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: { agentStatus: true },
  })
}

async function handleTerminalStatus(
  status: string,
  runId: string
): Promise<AgentResult> {
  if (status === 'CANCELED') await markRunCanceled(runId)
  return { outcome: 'failed', error: `Agent ${status}` }
}

async function handleExecutionError(
  error: unknown,
  ctx: RunContext
): Promise<AgentResult> {
  const current = await checkCurrentStatus(ctx.taskId)

  if (
    current?.agentStatus === 'INPUT_REQUIRED' ||
    current?.agentStatus === 'CANCELED'
  ) {
    return handleTerminalStatus(current.agentStatus, ctx.currentRunId)
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

// ── Spec generation shortcut ─────────────────────────────────────────────

async function handleMissingSpec(
  taskId: string,
  task: Awaited<ReturnType<typeof loadTask>>
): Promise<AgentResult> {
  await generateSpecDraft(taskId, {
    title: task.title,
    description: task.description,
    spec: task.spec,
    project: { id: task.project.id },
  })
  return { outcome: 'spec_review' } as AgentResult
}

// ── Timeout handler ──────────────────────────────────────────────────────

function setupTimeout(
  taskId: string,
  projectId: string,
  runId: string,
  onTimeout: () => void
): NodeJS.Timeout {
  return setTimeout(async () => {
    onTimeout()
    await markFailed(
      taskId,
      projectId,
      'TIMEOUT',
      'Agent timed out after 28 minutes',
      runId
    )
  }, AGENT_TIMEOUT_MS)
}

// ── Post-agent pipeline ─────────────────────────────────────────────────

async function processPostAgent(
  sandbox: Sandbox,
  ctx: RunContext,
  branchExistsOnRemote: boolean
): Promise<AgentResult> {
  const diffBase = getDiffBase(
    ctx.isFollowUp,
    branchExistsOnRemote,
    ctx.branchName
  )
  const hasCommits = await checkForCommits(sandbox, ctx.branchName, diffBase)

  if (!hasCommits) {
    return handleNoCommits(ctx, ctx.isFollowUp && branchExistsOnRemote)
  }

  await pushBranch(sandbox, ctx.taskId, ctx.branchName)
  const runMeta = await collectRunMetadata(sandbox, diffBase, ctx.branchName)
  const { prUrl, prNumber } = await createOrReusePR(
    ctx,
    branchExistsOnRemote,
    runMeta
  )

  await emitDoneEvents(ctx, prUrl, prNumber, runMeta)
  return { outcome: 'done', prUrl, prNumber }
}

async function emitDoneEvents(
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

// ── Sandbox pipeline ────────────────────────────────────────────────────

async function setupSandboxAndRepo(
  sandbox: Sandbox,
  ctx: RunContext
): Promise<boolean> {
  await cloneRepo(sandbox, ctx)
  await installClaude(sandbox, ctx.taskId)
  const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!callbackUrl) {
    throw new AgentError(
      'CONFIG_ERROR',
      'NEXT_PUBLIC_APP_URL is required for MCP server communication'
    )
  }
  await installMcpServer(sandbox, {
    taskId: ctx.taskId,
    callbackUrl,
  })
  const branchExistsOnRemote = await checkoutBranch(sandbox, ctx)
  await writeTaskSpec(sandbox, ctx)
  return branchExistsOnRemote
}

// ── Main orchestrator ─────────────────────────────────────────────────────

export async function executeAgent({
  taskId,
  actorName,
  actorEmail,
  trigger,
}: ExecuteAgentOptions): Promise<AgentResult> {
  const task = await loadTask(taskId)
  if (!task.spec?.trim()) return handleMissingSpec(taskId, task)

  const ctx = await buildRunContext(task, {
    taskId,
    actorName,
    actorEmail,
    trigger,
  })
  let sandbox: Sandbox | undefined
  let timedOut = false

  const timeoutHandle = setupTimeout(
    taskId,
    task.project.id,
    ctx.currentRunId,
    () => {
      timedOut = true
      if (sandbox) sandbox.kill().catch(() => {})
    }
  )

  try {
    sandbox = await createSandbox(ctx.currentRunId)
    const branchExistsOnRemote = await setupSandboxAndRepo(sandbox, ctx)

    const agentResult = await runClaude(sandbox, ctx)
    if (timedOut) return { outcome: 'failed', error: 'Agent timed out' }
    if (agentResult !== 'agent_done') return agentResult

    return processPostAgent(sandbox, ctx, branchExistsOnRemote)
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
  const taskSpec = htmlToMarkdown(task.spec ?? task.description ?? task.title)
  const { githubToken, anthropicKey } = await resolveCredentials()
  const { gitName, gitEmail } = resolveGitIdentity(
    opts.actorName,
    opts.actorEmail
  )
  const currentRunId = await createAgentRun(
    opts.taskId,
    task.project.id,
    opts.trigger ?? 'initial'
  )

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
    currentRunId,
    agentStartedAt: Date.now(),
    gitName,
    gitEmail,
  }
}
