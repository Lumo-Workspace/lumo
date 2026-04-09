import { randomBytes } from 'crypto'
import { Sandbox } from '@e2b/code-interpreter'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getGithubInstallationToken } from '@/lib/integrations/github'
import {
  pushAgentEvent,
  fireAgentEvent,
  pushTaskEvent,
} from '@/lib/integrations/pusher'
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
} from '@/lib/services/notification.service'
import { htmlToMarkdown } from '@/lib/utils/markdown'
import { installMcpServer, MCP_CONFIG_PATH } from '@/lib/integrations/sandbox'
import { buildAgentContext } from './context-builder'

// ── Constants ──────────────────────────────────────────────────────────────

// Agent runs inside an E2B sandbox that lives independently of the Vercel
// function.  The function only performs setup (~2 min), then the sandbox
// executes the Claude CLI in the background.  A webhook callback triggers
// post-processing when the agent finishes.
const AGENT_TIMEOUT_MS = 30 * 60 * 1000 // hard ceiling enforced via `timeout` in sandbox
const SANDBOX_TIMEOUT_MS = 55 * 60 * 1000 // E2B sandbox lifetime (max 1h on Base)
const CLONE_TIMEOUT_MS = 2 * 60 * 1000
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000
const PUSH_TIMEOUT_MS = 60 * 1000

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
  mcpToken: string
  agentStartedAt: number
  gitName: string
  gitEmail: string
}

type ChangedFile = {
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
): Promise<{ id: string; mcpToken: string }> {
  const runNumber = await nextRunNumber(taskId)
  const mcpToken = randomBytes(32).toString('hex')
  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      runNumber,
      status: 'WORKING',
      trigger,
      mcpToken,
      steps: buildInitialSteps() as unknown as Prisma.InputJsonValue,
    },
  })
  await transitionAgentStatus(taskId, projectId, 'WORKING', {
    agentError: null,
  })
  fireAgentEvent(taskId, {
    type: 'agent:started',
    runNumber,
    steps: buildInitialSteps(),
  })
  runStepTimers.set(agentRun.id, Date.now())
  return { id: agentRun.id, mcpToken }
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

async function updateFailedRun(
  agentRunId: string,
  code: string,
  detail: string
) {
  await prisma.agentRun.update({
    where: { id: agentRunId },
    data: {
      status: 'FAILED',
      errorCode: code,
      errorMessage: detail,
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
  const friendly = userFriendlyError(code)
  // Combine friendly message with actual detail for debugging
  const detail =
    message && message !== friendly
      ? `${friendly}\n\nDetail: ${message}`
      : friendly

  await transitionAgentStatus(taskId, projectId, 'FAILED', {
    agentError: code,
  })
  await pushAgentEvent(taskId, {
    type: 'agent:failed',
    error: detail,
  })
  await notifyAgentFailed(taskId)
  if (agentRunId) await updateFailedRun(agentRunId, code, detail)
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
  console.log(`[Agent] Creating sandbox (timeout=${SANDBOX_TIMEOUT_MS}ms)...`)
  const sandbox = await Sandbox.create({
    timeoutMs: SANDBOX_TIMEOUT_MS,
  }).catch(err => {
    throw new AgentError(
      'SANDBOX_CREATE_FAILED',
      'Failed to create sandbox',
      err
    )
  })
  console.log(`[Agent] Sandbox created: ${sandbox.sandboxId}`)
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
    | 'taskId'
    | 'currentRunId'
    | 'repoOwner'
    | 'repoName'
    | 'githubToken'
    | 'gitName'
    | 'gitEmail'
  >
) {
  console.log(`[Agent] Cloning repo ${ctx.repoOwner}/${ctx.repoName}...`)
  fireProgress(
    ctx.taskId,
    ctx.currentRunId,
    'clone',
    `Cloning ${ctx.repoOwner}/${ctx.repoName}...`
  )
  const clone = await sandbox.commands
    .run(buildCloneCommand(ctx), { timeoutMs: CLONE_TIMEOUT_MS })
    .catch(err => {
      throw new AgentError('CLONE_FAILED', 'Failed to clone repository', err)
    })
  if (clone.exitCode !== 0) {
    throw new AgentError('CLONE_FAILED', `Git clone failed: ${clone.stderr}`)
  }
}

async function installClaude(sandbox: Sandbox, taskId: string, runId: string) {
  console.log('[Agent] Installing Claude Code...')
  fireProgress(taskId, runId, 'setup', 'Setting up environment...')
  const install = await sandbox.commands
    .run('sudo npm install -g @anthropic-ai/claude-code', {
      timeoutMs: INSTALL_TIMEOUT_MS,
    })
    .catch(err => {
      throw new AgentError(
        'AGENT_EXECUTION_FAILED',
        `Failed to install Claude Code: ${err.message}`
      )
    })
  if (install.exitCode !== 0) {
    throw new AgentError(
      'AGENT_EXECUTION_FAILED',
      `Failed to install Claude Code (exit ${install.exitCode}): ${install.stderr?.slice(-300) || '(no stderr)'}`
    )
  }
  console.log('[Agent] Claude Code installed')
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
  runId: string,
  branchName: string
) {
  fireProgress(
    taskId,
    runId,
    'branch',
    `Checking out existing branch ${branchName}...`
  )
  await sandbox.commands.run(
    `git -C /home/user/repo fetch origin ${branchName} && git -C /home/user/repo checkout ${branchName}`,
    { timeoutMs: PUSH_TIMEOUT_MS }
  )
}

async function createBranch(
  sandbox: Sandbox,
  taskId: string,
  runId: string,
  branchName: string
) {
  fireProgress(taskId, runId, 'branch', `Creating branch ${branchName}...`)
  await sandbox.commands.run(`git -C /home/user/repo checkout -b ${branchName}`)
}

async function checkoutBranch(
  sandbox: Sandbox,
  ctx: Pick<RunContext, 'taskId' | 'currentRunId' | 'branchName' | 'isFollowUp'>
): Promise<boolean> {
  const branchExistsOnRemote =
    ctx.isFollowUp && (await checkRemoteBranchExists(sandbox, ctx.branchName))

  if (branchExistsOnRemote) {
    await fetchAndCheckout(
      sandbox,
      ctx.taskId,
      ctx.currentRunId,
      ctx.branchName
    )
  } else {
    await createBranch(sandbox, ctx.taskId, ctx.currentRunId, ctx.branchName)
  }
  return branchExistsOnRemote
}

// ── Task spec ─────────────────────────────────────────────────────────────

async function writeTaskSpec(sandbox: Sandbox, ctx: RunContext) {
  const content = await buildAgentContext({
    taskId: ctx.taskId,
    branchName: ctx.branchName,
    identifier: ctx.identifier,
  })
  await sandbox.files.write('/home/user/task.md', content)
}

// ── Agent execution ───────────────────────────────────────────────────────

const CLAUDE_ALLOWED_TOOLS =
  'Read,Write,Edit,' +
  'Bash(git add *),Bash(git commit *),Bash(git push *),Bash(npm *),Bash(npx *),' +
  'Bash(ls *),Bash(cat *),Bash(mkdir *),' +
  'mcp__lumo-sandbox__ask_user,mcp__lumo-sandbox__report_progress'

// ── Pipeline stages ──────────────────────────────────────────────────────

/** Known pipeline stages — order matters. */
const PIPELINE_STAGES = [
  { key: 'clone', label: 'Clone repository' },
  { key: 'setup', label: 'Set up environment' },
  { key: 'branch', label: 'Prepare branch' },
  { key: 'analyze', label: 'Analyze codebase' },
  { key: 'verify', label: 'Verify changes' },
  { key: 'metadata', label: 'Collect run metadata' },
  { key: 'pr', label: 'Create pull request' },
] as const

type StageKey = (typeof PIPELINE_STAGES)[number]['key']

interface PipelineStep {
  key: string
  text: string
  elapsedMs: number
  status: 'pending' | 'done'
}

/** Build the initial steps array with all stages as pending. */
function buildInitialSteps(): PipelineStep[] {
  return PIPELINE_STAGES.map(s => ({
    key: s.key,
    text: s.label,
    elapsedMs: 0,
    status: 'pending' as const,
  }))
}

/** Mark a pipeline step as done (by key) in the DB. */
function markStepDone(
  runId: string,
  key: StageKey,
  text: string,
  elapsedMs: number
): void {
  // Read-modify-write: safe because there's only one writer per run
  prisma.agentRun
    .findUnique({ where: { id: runId }, select: { steps: true } })
    .then(run => {
      if (!run?.steps || !Array.isArray(run.steps)) return
      const updated = (run.steps as unknown as PipelineStep[]).map(s =>
        s.key === key ? { ...s, status: 'done' as const, text, elapsedMs } : s
      )
      return prisma.agentRun.update({
        where: { id: runId },
        data: { steps: updated as unknown as Prisma.InputJsonValue },
      })
    })
    .catch(err => console.error('[Agent] Failed to update step:', err))
}

/** Tracks the timestamp of the last completed step per run. */
const runStepTimers = new Map<string, number>()

/**
 * Fire a progress Pusher event AND mark the pipeline step as done in DB.
 * Elapsed time is automatically computed from the previous step's completion.
 */
function fireProgress(
  taskId: string,
  runId: string,
  key: StageKey,
  message: string
): void {
  const now = Date.now()
  const lastTime = runStepTimers.get(runId) ?? now
  const elapsedMs = now - lastTime
  runStepTimers.set(runId, now)

  fireAgentEvent(taskId, { type: 'agent:progress', message, key })
  markStepDone(runId, key, message, elapsedMs)
}

/**
 * Write the agent runner script and completion callback to the sandbox.
 * The runner executes Claude CLI with a timeout, then calls our webhook
 * with the exit code so we can do post-processing from a fresh function.
 */
async function writeAgentScript(
  sandbox: Sandbox,
  ctx: RunContext,
  branchExistsOnRemote: boolean
): Promise<void> {
  const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
  const timeoutSecs = Math.floor(AGENT_TIMEOUT_MS / 1000)

  const runScript = `#!/bin/bash
cd /home/user/repo
export ANTHROPIC_API_KEY="${ctx.anthropicKey}"

timeout --signal=TERM ${timeoutSecs} \\
  claude -p "$(cat /home/user/task.md)" \\
  --allowedTools "${CLAUDE_ALLOWED_TOOLS}" \\
  --mcp-config ${MCP_CONFIG_PATH} \\
  --output-format stream-json --verbose --max-turns 50 \\
  > /tmp/agent-stdout.log 2>/tmp/agent-stderr.log

EXIT_CODE=$?
python3 /home/user/send-callback.py $EXIT_CODE
`

  const callbackPy = `import json, sys, urllib.request

exit_code = int(sys.argv[1])

stderr = ""
try:
    with open("/tmp/agent-stderr.log") as f:
        content = f.read()
        stderr = content[-500:] if content else ""
except:
    pass

payload = json.dumps({
    "runId": ${JSON.stringify(ctx.currentRunId)},
    "taskId": ${JSON.stringify(ctx.taskId)},
    "exitCode": exit_code,
    "timedOut": exit_code == 124,
    "stderr": stderr,
    "branchExistsOnRemote": ${JSON.stringify(branchExistsOnRemote)},
})

req = urllib.request.Request(
    ${JSON.stringify(`${callbackUrl}/api/agent/sandbox-done`)},
    data=payload.encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": ${JSON.stringify(`Bearer ${ctx.mcpToken}`)},
    },
    method="POST",
)

# Retry up to 3 times with backoff
import time
for attempt in range(3):
    try:
        urllib.request.urlopen(req, timeout=30)
        print(f"Callback sent successfully (attempt {attempt + 1})")
        break
    except Exception as e:
        print(f"Callback attempt {attempt + 1} failed: {e}", file=sys.stderr)
        if attempt < 2:
            time.sleep(2 ** attempt)
`

  await sandbox.files.write('/home/user/run-agent.sh', runScript)
  await sandbox.files.write('/home/user/send-callback.py', callbackPy)
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

// ── Run metadata collection (via GitHub API) ────────────────────────────

async function collectChangedFilesFromGitHub(
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

function mapGitHubFileStatus(
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

async function collectCommitSummaryFromGitHub(
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

async function collectRunMetadata(ctx: {
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

function buildPRBody(taskSpec: string, identifier: string): string {
  return `## Summary\n\n${taskSpec}\n\n---\n_This PR was created by Lumo Agent_\n\nRelated task: ${identifier}`
}

async function createNewPR(
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

// ── Post-agent pipeline ─────────────────────────────────────────────────

/**
 * Post-agent processing — no sandbox required.
 * Agent is responsible for pushing its branch. We use GitHub API to
 * verify the push, collect metadata, and create the PR.
 */
async function processPostAgent(
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
    console.warn(
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

async function checkBranchOnGitHub(
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

    console.log(
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
}): Promise<void> {
  const { runId, taskId, exitCode, timedOut, stderr, branchExistsOnRemote } =
    params

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
  console.log(
    `[Agent] Agent done for task ${taskId}, proceeding to post-processing`
  )

  const resolvedRepo = resolveRepo(task)
  const [repoOwner, repoName] = resolvedRepo.split('/')
  if (!repoOwner || !repoName)
    throw new Error(`Invalid repo format: ${resolvedRepo}`)

  const identifier = `LUM-${task.number}`
  const { branchName, isFollowUp } = resolveBranch(task, identifier)
  const taskSpec = htmlToMarkdown(task.spec ?? task.description ?? task.title)
  const { githubToken } = await resolveCredentials()
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
  const { githubToken, anthropicKey } = await resolveCredentials()
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
