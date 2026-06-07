import { logger } from '@/lib/logger'
import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { getGithubInstallationToken } from '@/lib/integrations/github'
import { AgentError, userFriendlyError } from './errors'
import { generateSpecDraft } from './generate-spec'
import { htmlToMarkdown } from '@/lib/utils/markdown'
import { installMcpServer } from '@/lib/integrations/sandbox'

// ── Imports from split modules ───────────────────────────────────────────

import {
  loadTask,
  createAgentRun,
  markFailed,
  markRunCanceled,
} from './run-lifecycle'
import {
  fireProgress,
  writeTaskSpec,
  writeAgentScript,
  finalizeClarify,
  runStepTimers,
} from './pipeline'
import {
  createSandbox,
  cloneRepo,
  installClaude,
  checkoutBranch,
} from './sandbox'
import { processPostAgent } from './post-agent'
import { parseStreamJsonUsage, type RunUsage } from '@lumo/shared'

// ── Re-exports for external consumers ────────────────────────────────────

export { loadTask } from './run-lifecycle'

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentResult =
  | { outcome: 'done'; prUrl: string; prNumber: number }
  | { outcome: 'failed'; error: string }
  | { outcome: 'clarify'; question: string }
  | { outcome: 'no_changes' }
  | { outcome: 'spec_review' }
  | { outcome: 'started' }

export interface ExecuteAgentOptions {
  taskId: string
  actorClerkId: string
  actorName?: string
  actorEmail?: string
  trigger?: string
}

/** Bundled context passed between execution phases. */
export interface RunContext {
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
  mcpToken: string
  agentStartedAt: number
  gitName: string
  gitEmail: string
  usage?: RunUsage | null | undefined
}

export type ChangedFile = {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
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

async function resolveCredentials(workspaceId?: string): Promise<{
  githubToken: string
  anthropicKey: string
}> {
  const githubToken = await getGithubInstallationToken(workspaceId).catch(
    err => {
      throw new AgentError('CLONE_FAILED', 'Failed to get GitHub token', err)
    }
  )
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')
  return { githubToken, anthropicKey }
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
    const causeMsg = error.cause instanceof Error ? error.cause.message : null
    const detail = causeMsg ? `${error.message} — ${causeMsg}` : error.message
    await markFailed(
      ctx.taskId,
      ctx.task.project.id,
      error.code,
      detail,
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

// ── Sandbox pipeline ────────────────────────────────────────────────────

async function setupSandboxAndRepo(
  sandbox: Sandbox,
  ctx: RunContext
): Promise<boolean> {
  await cloneRepo(sandbox, ctx)
  await installClaude(sandbox, ctx.taskId, ctx.currentRunId)
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
    callbackToken: ctx.mcpToken,
  })
  const branchExistsOnRemote = await checkoutBranch(sandbox, ctx)
  await writeTaskSpec(sandbox, ctx)
  return branchExistsOnRemote
}

// ── Main orchestrator ─────────────────────────────────────────────────────

/**
 * Phase 1 — Setup.
 *
 * Creates an E2B sandbox, clones the repo, installs Claude Code, checks
 * out the branch, writes the task spec, then starts the Claude CLI in the
 * background.  The sandbox runs independently — when the CLI finishes,
 * a callback script POSTs to `/api/agent/sandbox-done` which triggers
 * Phase 2 (post-processing).
 */
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

  try {
    sandbox = await createSandbox(ctx.currentRunId)
    const branchExistsOnRemote = await setupSandboxAndRepo(sandbox, ctx)

    // Fire the "analyze" step before handing off to the background
    fireProgress(
      ctx.taskId,
      ctx.currentRunId,
      'analyze',
      'Agent is analyzing the codebase...'
    )

    // Write runner + callback scripts, then start in background
    await writeAgentScript(sandbox, ctx, branchExistsOnRemote)
    await sandbox.commands.run('bash /home/user/run-agent.sh', {
      background: true,
    })

    logger.debug(
      `[Agent] Agent started in background for task ${taskId}, sandbox ${sandbox.sandboxId}`
    )
    // Do NOT kill sandbox — it runs independently
    return { outcome: 'started' }
  } catch (error) {
    // Setup failed — kill sandbox and report error
    runStepTimers.delete(ctx.currentRunId)
    if (sandbox) await sandbox.kill().catch(() => {})
    return handleExecutionError(error, ctx)
  }
}

// ── Phase 2: Completion callback ────────────────────────────────────────

/**
 * Called by `POST /api/agent/sandbox-done` when the sandbox finishes.
 * Handles post-processing: verify push, collect metadata, create/update PR.
 */
export async function processAgentCompletion(params: {
  runId: string
  taskId: string
  exitCode: number
  timedOut: boolean
  stderr: string
  branchExistsOnRemote: boolean
  resultLine?: string | undefined
}): Promise<void> {
  const { runId, taskId, exitCode, timedOut, stderr, branchExistsOnRemote } =
    params
  const usage = params.resultLine
    ? parseStreamJsonUsage(params.resultLine)
    : null

  const task = await loadTask(taskId)
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { startedAt: true, sandboxId: true },
  })
  if (!run) throw new Error(`AgentRun ${runId} not found`)

  // Kill the sandbox now that the agent is done
  if (run.sandboxId) {
    Sandbox.connect(run.sandboxId)
      .then(sb => sb.kill())
      .catch(() => {})
  }

  // Check current status — may have been canceled while running
  const current = await checkCurrentStatus(taskId)
  if (current?.agentStatus === 'CANCELED') {
    await markRunCanceled(runId)
    return
  }

  // Handle timeout
  if (timedOut) {
    await markFailed(
      taskId,
      task.project.id,
      'TIMEOUT',
      'Agent timed out',
      runId
    )
    return
  }

  // Check for pending clarify (agent exited after ask_user)
  const pendingClarify = await prisma.agentClarify.findFirst({
    where: { taskId, reply: null },
    orderBy: { createdAt: 'desc' },
  })
  if (pendingClarify) {
    await finalizeClarify(taskId, runId)
    return
  }

  // Handle non-zero exit
  if (exitCode !== 0) {
    const detail = stderr
      ? `Agent exited with code ${exitCode}\nstderr: ${stderr}`
      : `Agent exited with code ${exitCode} (no stderr)`
    await markFailed(
      taskId,
      task.project.id,
      'AGENT_EXECUTION_FAILED',
      detail,
      runId
    )
    return
  }

  // Success — post-processing via GitHub API
  logger.debug(
    `[Agent] Agent done for task ${taskId}, proceeding to post-processing`
  )

  const resolvedRepo = resolveRepo(task)
  const [repoOwner, repoName] = resolvedRepo.split('/')
  if (!repoOwner || !repoName)
    throw new Error(`Invalid repo format: ${resolvedRepo}`)

  const identifier = `LUM-${task.number}`
  const { branchName, isFollowUp } = resolveBranch(task, identifier)
  const taskSpec = htmlToMarkdown(task.spec ?? task.description ?? task.title)
  const { githubToken } = await resolveCredentials(task.project.workspaceId)
  const { gitName, gitEmail } = resolveGitIdentity()

  const ctx: RunContext = {
    taskId,
    task,
    identifier,
    branchName,
    isFollowUp: isFollowUp || branchExistsOnRemote,
    taskSpec,
    repoOwner,
    repoName,
    resolvedRepo,
    githubToken,
    anthropicKey: '',
    currentRunId: runId,
    mcpToken: '',
    agentStartedAt: run.startedAt.getTime(),
    gitName,
    gitEmail,
    usage,
  }

  // Initialize step timer for post-processing stages
  runStepTimers.set(runId, Date.now())

  try {
    await processPostAgent(ctx, branchExistsOnRemote)
  } catch (error) {
    await handleExecutionError(error, ctx)
  } finally {
    runStepTimers.delete(runId)
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
  const { githubToken, anthropicKey } = await resolveCredentials(
    task.project.workspaceId
  )
  const { gitName, gitEmail } = resolveGitIdentity(
    opts.actorName,
    opts.actorEmail
  )
  const { id: currentRunId, mcpToken } = await createAgentRun(
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
    mcpToken,
    agentStartedAt: Date.now(),
    gitName,
    gitEmail,
  }
}
