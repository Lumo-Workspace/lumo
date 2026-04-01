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

const AGENT_TIMEOUT_MS = 28 * 60 * 1000 // 28 min business-layer timeout
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000 // 30 min E2B sandbox timeout

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
      return i.file_path ?? ''
    case 'Write':
      return i.file_path ?? ''
    case 'Edit':
      return i.file_path ?? ''
    case 'Bash':
      return (i.command ?? '').slice(0, 80)
    default:
      return ''
  }
}

async function createPullRequest({
  owner,
  repo,
  branch,
  title,
  body,
  token,
  baseBranch = 'main',
}: {
  owner: string
  repo: string
  branch: string
  title: string
  body: string
  token: string
  baseBranch?: string
}) {
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

async function nextRunNumber(taskId: string): Promise<number> {
  const last = await prisma.agentRun.findFirst({
    where: { taskId },
    orderBy: { runNumber: 'desc' },
    select: { runNumber: true },
  })
  return (last?.runNumber ?? 0) + 1
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

export type AgentResult =
  | { outcome: 'done'; prUrl: string; prNumber: number }
  | { outcome: 'failed'; error: string }
  | { outcome: 'clarify'; question: string }
  | { outcome: 'no_changes' }
  | { outcome: 'spec_review' }

// ── Complete agent run: set COMPLETED + IN_REVIEW + persist branch/PR ────────

async function completeAgentRun(params: {
  taskId: string
  projectId: string
  taskStatus: string
  branchName: string
  resolvedRepo: string
  agentRunId?: string
  agentSummary?: string | null
  agentChangedFiles?: {
    path: string
    status: 'added' | 'modified' | 'deleted'
  }[]
  agentDurationMs?: number | null
  prUpsertData?: {
    workspaceId: string
    number: number
    title: string
    url: string
  }
}): Promise<void> {
  const { taskId, projectId, taskStatus, branchName, resolvedRepo } = params

  // Transitions with skipDispatch — dispatch after all DB writes complete
  const agentEvents = await transitionAgentStatus(
    taskId,
    projectId,
    'COMPLETED',
    {
      skipDispatch: true,
    }
  )

  let taskEvents: DomainEvent[] = []
  try {
    taskEvents = await transitionTaskStatus(taskId, projectId, 'IN_REVIEW', {
      currentStatus: taskStatus as TaskStatusValue,
      skipDispatch: true,
    })
  } catch {
    console.warn(
      `[Agent] Skipping task status → IN_REVIEW: invalid from ${taskStatus}`
    )
  }

  const branchUpsert = prisma.taskBranch.upsert({
    where: {
      taskId_repo_branchName: { taskId, repo: resolvedRepo, branchName },
    },
    create: { taskId, repo: resolvedRepo, branchName },
    update: {},
  })

  if (params.prUpsertData) {
    const { workspaceId, number, title, url } = params.prUpsertData
    await prisma.$transaction([
      branchUpsert,
      prisma.pullRequest.upsert({
        where: { repo_number: { repo: resolvedRepo, number } },
        create: {
          workspaceId,
          taskId,
          repo: resolvedRepo,
          number,
          title,
          url,
          state: 'open',
          authorLogin: 'lumo-agent',
          headBranch: branchName,
          baseBranch: 'main',
        },
        update: { state: 'open', url, taskId },
      }),
    ])
  } else {
    await branchUpsert
  }

  // Dispatch all events after DB writes complete
  await dispatchEvents([...agentEvents, ...taskEvents])

  // Update AgentRun record
  if (params.agentRunId) {
    await prisma.agentRun.update({
      where: { id: params.agentRunId },
      data: {
        status: 'COMPLETED',
        summary: params.agentSummary ?? null,
        changedFiles: params.agentChangedFiles ?? Prisma.DbNull,
        durationMs: params.agentDurationMs ?? null,
        prNumber: params.prUpsertData?.number ?? null,
        prUrl: params.prUpsertData?.url ?? null,
        branchName: params.branchName,
        finishedAt: new Date(),
      },
    })
  }

  // Send AGENT_VERIFY inbox notification so the reviewer can confirm or send back
  await notifyAgentVerify(taskId)
}

/** Collect changed files and commit summary from the sandbox after agent completes. */
async function collectRunMetadata(
  sandbox: Sandbox,
  diffBase: string,
  branchName: string
): Promise<{
  changedFiles: { path: string; status: 'added' | 'modified' | 'deleted' }[]
  summary: string
}> {
  const STATUS_MAP: Record<string, 'added' | 'modified' | 'deleted'> = {
    A: 'added',
    M: 'modified',
    D: 'deleted',
  }

  // Changed files
  const diffResult = await sandbox.commands
    .run(
      `git -C /home/user/repo diff --name-status ${diffBase}..${branchName} 2>/dev/null`
    )
    .catch(() => ({ stdout: '' }))
  const changedFiles = (diffResult.stdout ?? '')
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

  // Summary from commit messages
  const logResult = await sandbox.commands
    .run(
      `git -C /home/user/repo log --format=%s ${diffBase}..${branchName} 2>/dev/null`
    )
    .catch(() => ({ stdout: '' }))
  const commits = (logResult.stdout ?? '').split('\n').filter(Boolean)
  const summary =
    commits.length === 1
      ? commits[0]!
      : commits.length > 1
        ? commits.join('; ')
        : 'Agent completed successfully'

  return { changedFiles, summary }
}

export interface ExecuteAgentOptions {
  taskId: string
  actorClerkId: string
  actorName?: string
  actorEmail?: string
  trigger?: string
}

export async function executeAgent({
  taskId,
  actorName,
  actorEmail,
  trigger,
  // actorClerkId reserved for audit logging
}: ExecuteAgentOptions): Promise<AgentResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      repository: { select: { fullName: true } },
      branches: {
        select: { branchName: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      pullRequests: {
        where: { state: 'open' },
        select: { headBranch: true },
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

  // If no spec yet, generate one from the description and pause for review
  if (!task.spec?.trim()) {
    await generateSpecDraft(taskId, {
      title: task.title,
      description: task.description,
      spec: task.spec,
      project: { id: task.project.id },
    })
    return { outcome: 'spec_review' } as AgentResult
  }

  // Resolve which repo to use: task-level → project default repo
  const resolvedRepo =
    task.repository?.fullName ?? task.project.repositories[0]?.fullName

  if (!resolvedRepo) {
    throw new Error(`Task ${taskId} has no GitHub repo configured`)
  }

  const githubToken = await getGithubInstallationToken().catch(err => {
    throw new AgentError('CLONE_FAILED', 'Failed to get GitHub token', err)
  })

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const [repoOwner, repoName] = resolvedRepo.split('/')
  if (!repoOwner || !repoName) {
    throw new Error(`Invalid repo format: ${resolvedRepo}`)
  }

  const identifier = `LUM-${task.number}`
  // Reuse existing branch if task already has one (e.g. follow-up @agent comment)
  const existingBranch =
    task.pullRequests[0]?.headBranch ?? task.branches[0]?.branchName ?? null
  const branchName =
    existingBranch ?? `lumo/${identifier}-${slugify(task.title)}`
  const isFollowUp = !!existingBranch
  // Convert HTML spec/description to markdown for the agent prompt
  const rawSpec = task.spec ?? task.description ?? task.title
  const taskSpec = htmlToMarkdown(rawSpec)

  const agentStartedAt = Date.now()

  // Create AgentRun record
  const runNumber = await nextRunNumber(taskId)
  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      runNumber,
      status: 'WORKING',
      trigger: trigger ?? 'initial',
    },
  })
  const currentRunId = agentRun.id

  await transitionAgentStatus(taskId, task.project.id, 'WORKING', {
    agentError: null,
  })
  await pushAgentEvent(taskId, { type: 'agent:started' })

  let sandbox: Sandbox | undefined
  let timedOut = false
  let clarifyHandle: ReturnType<typeof monitorForClarify> | undefined

  const timeoutHandle = setTimeout(async () => {
    timedOut = true
    await markFailed(
      taskId,
      task.project.id,
      'TIMEOUT',
      'Agent timed out after 28 minutes',
      currentRunId
    )
    if (sandbox) await sandbox.kill().catch(() => {})
  }, AGENT_TIMEOUT_MS)

  try {
    sandbox = await Sandbox.create({
      timeoutMs: SANDBOX_TIMEOUT_MS,
    }).catch(err => {
      throw new AgentError(
        'SANDBOX_CREATE_FAILED',
        'Failed to create sandbox',
        err
      )
    })

    await prisma.agentRun.update({
      where: { id: currentRunId },
      data: { sandboxId: sandbox.sandboxId },
    })

    const gitName = actorName ? `${actorName} (via Lumo Agent)` : 'Lumo Agent'
    const gitEmail = actorEmail || 'agent@uselumo.ai'

    // Clone repo
    await pushAgentEvent(taskId, {
      type: 'agent:progress',
      message: `Cloning ${repoOwner}/${repoName}...`,
    })
    const clone = await sandbox.commands
      .run(
        `git clone https://oauth2:${githubToken}@github.com/${repoOwner}/${repoName} /home/user/repo` +
          ` && git -C /home/user/repo config user.email "${gitEmail}"` +
          ` && git -C /home/user/repo config user.name "${gitName}"`,
        { timeoutMs: 2 * 60 * 1000 }
      )
      .catch(err => {
        throw new AgentError('CLONE_FAILED', 'Failed to clone repository', err)
      })

    if (clone.exitCode !== 0) {
      throw new AgentError('CLONE_FAILED', `Git clone failed: ${clone.stderr}`)
    }

    // Install Claude Code CLI
    await pushAgentEvent(taskId, {
      type: 'agent:progress',
      message: 'Setting up environment...',
    })
    await sandbox.commands.run(
      'sudo npm install -g @anthropic-ai/claude-code',
      {
        timeoutMs: 3 * 60 * 1000,
      }
    )

    // Checkout branch (reuse existing or create new)
    // First check if branch exists on remote (avoids E2B throwing on non-zero exit)
    let branchExistsOnRemote = false
    if (isFollowUp) {
      const lsRemote = await sandbox.commands
        .run(`git -C /home/user/repo ls-remote --heads origin ${branchName}`, {
          timeoutMs: 30 * 1000,
        })
        .catch(() => ({ stdout: '' }))
      branchExistsOnRemote = !!(lsRemote.stdout && lsRemote.stdout.trim())
    }

    if (branchExistsOnRemote) {
      await pushAgentEvent(taskId, {
        type: 'agent:progress',
        message: `Checking out existing branch ${branchName}...`,
      })
      await sandbox.commands.run(
        `git -C /home/user/repo fetch origin ${branchName} && git -C /home/user/repo checkout ${branchName}`,
        { timeoutMs: 60 * 1000 }
      )
    } else {
      await pushAgentEvent(taskId, {
        type: 'agent:progress',
        message: `Creating branch ${branchName}...`,
      })
      await sandbox.commands.run(
        `git -C /home/user/repo checkout -b ${branchName}`
      )
    }

    // Write task spec file
    await sandbox.files.write(
      '/home/user/task.md',
      `# Task: ${task.title}
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
The system will deliver your question to the assignee and restart you with the answer.`.trim()
    )

    await pushAgentEvent(taskId, {
      type: 'agent:progress',
      message: 'Agent is analyzing the codebase...',
    })

    const monitorTask = {
      id: taskId,
      identifier,
      reviewerId: '',
      projectId: task.project.id,
    }

    const CLARIFY_SENTINEL = '__clarify__'
    clarifyHandle = monitorForClarify(sandbox, monitorTask)

    const winner = await Promise.race([
      sandbox.commands
        .run(
          `cd /home/user/repo && ANTHROPIC_API_KEY=${anthropicKey} claude -p "$(cat /home/user/task.md)"` +
            ` --allowedTools "Read,Write,Edit,Bash(git add *),Bash(git commit *),Bash(npm *),Bash(npx *),Bash(ls *),Bash(cat *),Bash(mkdir *)"` +
            ` --output-format stream-json --verbose --bare --max-turns 50`,
          {
            timeoutMs: 25 * 60 * 1000,
            onStdout: async (data: string) => {
              try {
                const msg = JSON.parse(data)
                if (msg.type === 'assistant') {
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
                        input: summarizeToolInput(
                          block.name as string,
                          block.input
                        ),
                      })
                    }
                  }
                }
              } catch {
                // Not JSON — skip
              }
            },
          }
        )
        .then(r => r)
        .catch(err => {
          throw new AgentError(
            'AGENT_EXECUTION_FAILED',
            'Agent execution failed',
            err
          )
        }),
      clarifyHandle.promise.then(() => CLARIFY_SENTINEL),
    ])

    // Stop the clarify monitor polling (no-op if it already resolved)
    clarifyHandle.stop()

    if (timedOut) return { outcome: 'failed', error: 'Agent timed out' }

    // Helper: finalize a clarify outcome (shared by monitor-wins and fallback paths)
    const finalizeClarify = async (): Promise<AgentResult> => {
      await prisma.agentClarify.updateMany({
        where: { taskId, agentRunId: null },
        data: { agentRunId: currentRunId },
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

    if (winner === CLARIFY_SENTINEL) {
      return finalizeClarify()
    }

    // Fallback: agent command exited before the monitor polled.
    // Do one final check for the clarify file.
    const clarifyFallback = await checkForClarifyFile(sandbox, monitorTask)
    if (clarifyFallback) {
      return finalizeClarify()
    }

    const result = winner as Awaited<ReturnType<typeof sandbox.commands.run>>
    if (result.exitCode !== 0) {
      throw new AgentError(
        'AGENT_EXECUTION_FAILED',
        `Agent exited with code ${result.exitCode}: ${result.stderr}`
      )
    }

    // Check if agent made any commits (compare against remote branch for follow-ups, main for new branches)
    const diffBase =
      isFollowUp && branchExistsOnRemote
        ? `origin/${branchName}`
        : 'origin/HEAD'
    const commitCheck = await sandbox.commands.run(
      `git -C /home/user/repo log --oneline ${diffBase}..${branchName} 2>/dev/null | head -1`
    )
    if (!commitCheck.stdout.trim()) {
      if (isFollowUp && branchExistsOnRemote) {
        // Follow-up with no new changes — work was already done
        const existingPr = await prisma.pullRequest.findFirst({
          where: { taskId, state: 'open' },
          select: { url: true, number: true },
        })
        await transitionAgentStatus(taskId, task.project.id, 'COMPLETED')
        const prUrl =
          existingPr?.url ?? `https://github.com/${resolvedRepo}/pulls`
        const prNumber = existingPr?.number ?? 0
        await prisma.agentRun.update({
          where: { id: currentRunId },
          data: {
            status: 'COMPLETED',
            durationMs: Date.now() - agentStartedAt,
            prNumber,
            prUrl,
            branchName,
            finishedAt: new Date(),
          },
        })
        await pushAgentEvent(taskId, {
          type: 'agent:done',
          prUrl,
          prNumber,
        })
        return { outcome: 'done', prUrl, prNumber }
      }
      await transitionAgentStatus(taskId, task.project.id, 'COMPLETED')
      await prisma.agentRun.update({
        where: { id: currentRunId },
        data: {
          status: 'COMPLETED',
          durationMs: Date.now() - agentStartedAt,
          finishedAt: new Date(),
        },
      })
      await pushAgentEvent(taskId, {
        type: 'agent:failed',
        error:
          'Agent made no changes. Please add a spec or description to the task.',
      })
      return { outcome: 'no_changes' }
    }

    // Push branch
    await pushAgentEvent(taskId, {
      type: 'agent:progress',
      message: 'Pushing branch...',
    })
    const push = await sandbox.commands
      .run(`git -C /home/user/repo push origin ${branchName}`, {
        timeoutMs: 60 * 1000,
      })
      .catch(err => {
        throw new AgentError('PUSH_FAILED', 'Failed to push branch', err)
      })

    if (push.exitCode !== 0) {
      throw new AgentError('PUSH_FAILED', `Git push failed: ${push.stderr}`)
    }

    // Collect run metadata from sandbox before proceeding
    const runMeta = await collectRunMetadata(sandbox, diffBase, branchName)
    const agentDurationMs = Date.now() - agentStartedAt

    // Create or reuse PR
    let prUrl: string
    let prNumber: number

    if (isFollowUp && branchExistsOnRemote && task.pullRequests[0]) {
      // Follow-up: PR already exists, just push updates the PR automatically
      await pushAgentEvent(taskId, {
        type: 'agent:progress',
        message: 'Updating existing pull request...',
      })
      const existingPr = await prisma.pullRequest.findFirst({
        where: { taskId, state: 'open' },
        select: { url: true, number: true },
      })
      prUrl = existingPr?.url ?? `https://github.com/${resolvedRepo}/pulls`
      prNumber = existingPr?.number ?? 0

      await completeAgentRun({
        taskId,
        projectId: task.project.id,
        taskStatus: task.status,
        branchName,
        resolvedRepo,
        agentRunId: currentRunId,
        agentSummary: runMeta.summary,
        agentChangedFiles: runMeta.changedFiles,
        agentDurationMs,
      })
    } else {
      await pushAgentEvent(taskId, {
        type: 'agent:progress',
        message: 'Creating pull request...',
      })
      const pr = await createPullRequest({
        owner: repoOwner,
        repo: repoName,
        branch: branchName,
        title: `${task.title} [${identifier}]`,
        body: `## Summary\n\n${taskSpec}\n\n---\n_This PR was created by Lumo Agent_\n\nRelated task: ${identifier}`,
        token: githubToken,
      })
      prUrl = pr.html_url
      prNumber = pr.number

      await completeAgentRun({
        taskId,
        projectId: task.project.id,
        taskStatus: task.status,
        branchName,
        resolvedRepo,
        agentRunId: currentRunId,
        agentSummary: runMeta.summary,
        agentChangedFiles: runMeta.changedFiles,
        agentDurationMs,
        prUpsertData: {
          workspaceId: task.project.workspaceId,
          number: pr.number,
          title: `${task.title} [${identifier}]`,
          url: pr.html_url,
        },
      })
    }

    await pushAgentEvent(taskId, {
      type: 'agent:done',
      prUrl,
      prNumber,
      summary: runMeta.summary,
      changedFiles: runMeta.changedFiles,
      durationMs: agentDurationMs,
    })

    // Push task-level update so detail page refreshes PR/branch data
    await pushTaskEvent(taskId, {
      type: 'task:updated',
      fields: ['status', 'agentStatus', 'pullRequests', 'branches'],
    })

    // Reviewer notification is handled by domain event handler (task → IN_REVIEW)

    return { outcome: 'done', prUrl, prNumber }
  } catch (error) {
    if (timedOut) return { outcome: 'failed', error: 'Agent timed out' }

    const current = await prisma.task.findUnique({
      where: { id: taskId },
      select: { agentStatus: true },
    })
    if (
      current?.agentStatus === 'INPUT_REQUIRED' ||
      current?.agentStatus === 'CANCELED'
    ) {
      // Update AgentRun for CANCELED (INPUT_REQUIRED is temporary, leave as WORKING)
      if (current.agentStatus === 'CANCELED') {
        await prisma.agentRun.update({
          where: { id: currentRunId },
          data: { status: 'CANCELED', finishedAt: new Date() },
        })
      }
      return { outcome: 'failed', error: `Agent ${current.agentStatus}` }
    }

    if (error instanceof AgentError) {
      await markFailed(
        taskId,
        task.project.id,
        error.code,
        error.message,
        currentRunId
      )
      return { outcome: 'failed', error: userFriendlyError(error.code) }
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    await markFailed(
      taskId,
      task.project.id,
      'UNKNOWN_ERROR',
      message,
      currentRunId
    )
    return { outcome: 'failed', error: userFriendlyError('UNKNOWN_ERROR') }
  } finally {
    clarifyHandle?.stop()
    clearTimeout(timeoutHandle)
    if (sandbox) await sandbox.kill().catch(() => {})
  }
}
