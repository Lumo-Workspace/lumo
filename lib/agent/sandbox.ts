import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { AgentError } from './errors'
import { fireProgress } from './pipeline'
import type { RunContext } from './execute'

// ── Constants ──────────────────────────────────────────────────────────────

const SANDBOX_TIMEOUT_MS = 55 * 60 * 1000 // E2B sandbox lifetime (max 1h on Base)
const CLONE_TIMEOUT_MS = 2 * 60 * 1000
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000
const PUSH_TIMEOUT_MS = 60 * 1000

// ── Sandbox setup ─────────────────────────────────────────────────────────

export async function createSandbox(runId: string): Promise<Sandbox> {
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

export function buildCloneCommand(
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

export async function cloneRepo(
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

export async function installClaude(
  sandbox: Sandbox,
  taskId: string,
  runId: string
) {
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

export async function checkRemoteBranchExists(
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

export async function fetchAndCheckout(
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

export async function createBranch(
  sandbox: Sandbox,
  taskId: string,
  runId: string,
  branchName: string
) {
  fireProgress(taskId, runId, 'branch', `Creating branch ${branchName}...`)
  await sandbox.commands.run(`git -C /home/user/repo checkout -b ${branchName}`)
}

export async function checkoutBranch(
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
