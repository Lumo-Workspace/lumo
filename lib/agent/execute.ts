import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { getGithubInstallationToken } from '@/lib/github/auth'
import { monitorForClarify } from './clarify-monitor'
import { pushAgentEvent } from '@/lib/pusher/server'
import { AgentError, userFriendlyError } from './errors'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'
import { generateSpecDraft } from './generate-spec'

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

async function markFailed(taskId: string, code: string, message: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: { agentStatus: 'failed', agentError: code, sandboxId: null },
  })
  await pushAgentEvent(taskId, {
    type: 'agent:failed',
    error: userFriendlyError(code),
  })
  console.error(`[Agent] Task ${taskId} failed [${code}]: ${message}`)
}

export interface ExecuteAgentOptions {
  taskId: string
  actorClerkId: string
}

export async function executeAgent({
  taskId,
  // actorClerkId reserved for audit logging
}: ExecuteAgentOptions): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      repository: { select: { fullName: true } },
      project: {
        select: {
          id: true,
          name: true,
          workspaceId: true,
          githubRepo: true,
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
      project: {
        workspaceId: task.project.workspaceId,
        defaultReviewerId: task.project.defaultReviewerId,
      },
      reviewerId: task.reviewerId,
    })
    return
  }

  // Resolve which repo to use: task-level → project default repo → legacy githubRepo
  const resolvedRepo =
    task.repository?.fullName ??
    task.project.repositories[0]?.fullName ??
    task.project.githubRepo

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
    throw new Error(`Invalid githubRepo format: ${resolvedRepo}`)
  }

  const identifier = `LUM-${task.number}`
  const branchName = `lumo/${identifier}-${slugify(task.title)}`
  const taskSpec = task.spec ?? task.description ?? task.title

  await prisma.task.update({
    where: { id: taskId },
    data: { agentStatus: 'running', agentError: null },
  })
  await pushAgentEvent(taskId, { type: 'agent:started' })

  const sandbox = await Sandbox.create({
    timeoutMs: SANDBOX_TIMEOUT_MS,
  }).catch(err => {
    throw new AgentError(
      'SANDBOX_CREATE_FAILED',
      'Failed to create sandbox',
      err
    )
  })

  let timedOut = false

  const timeoutHandle = setTimeout(async () => {
    timedOut = true
    await markFailed(taskId, 'TIMEOUT', 'Agent timed out after 28 minutes')
    await sandbox.kill().catch(() => {})
  }, AGENT_TIMEOUT_MS)

  try {
    await prisma.task.update({
      where: { id: taskId },
      data: { sandboxId: sandbox.sandboxId },
    })

    // Clone repo
    await pushAgentEvent(taskId, {
      type: 'agent:progress',
      message: `Cloning ${repoOwner}/${repoName}...`,
    })
    const clone = await sandbox.commands
      .run(
        `git clone https://oauth2:${githubToken}@github.com/${repoOwner}/${repoName} /home/user/repo` +
          ` && git -C /home/user/repo config user.email "agent@uselumo.ai"` +
          ` && git -C /home/user/repo config user.name "Lumo Agent"`,
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

    // Create branch
    await pushAgentEvent(taskId, {
      type: 'agent:progress',
      message: `Creating branch ${branchName}...`,
    })
    await sandbox.commands.run(
      `git -C /home/user/repo checkout -b ${branchName}`
    )

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
- Do NOT push; do NOT create a PR (handled automatically)`.trim()
    )

    await pushAgentEvent(taskId, {
      type: 'agent:progress',
      message: 'Agent is analyzing the codebase...',
    })

    const reviewerMemberId =
      task.reviewerId ?? task.project.defaultReviewerId ?? ''
    const monitorTask = { id: taskId, identifier, reviewerId: reviewerMemberId }

    const CLARIFY_SENTINEL = '__clarify__'
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
      monitorForClarify(sandbox, monitorTask).then(() => CLARIFY_SENTINEL),
    ])

    if (timedOut) return

    if (winner === CLARIFY_SENTINEL) {
      const clarify = await prisma.agentClarify.findFirst({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
      })
      await pushAgentEvent(taskId, {
        type: 'agent:clarify',
        question: clarify?.question ?? '',
        context: clarify?.context ?? null,
      })
      return
    }

    const result = winner as Awaited<ReturnType<typeof sandbox.commands.run>>
    if (result.exitCode !== 0) {
      throw new AgentError(
        'AGENT_EXECUTION_FAILED',
        `Agent exited with code ${result.exitCode}: ${result.stderr}`
      )
    }

    // Check if agent made any commits
    const commitCheck = await sandbox.commands.run(
      `git -C /home/user/repo log --oneline origin/HEAD..${branchName} 2>/dev/null | head -1`
    )
    if (!commitCheck.stdout.trim()) {
      await prisma.task.update({
        where: { id: taskId },
        data: { agentStatus: 'done' },
      })
      await pushAgentEvent(taskId, {
        type: 'agent:failed',
        error:
          'Agent made no changes. Please add a spec or description to the task.',
      })
      await sandbox.kill().catch(() => {})
      return
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

    // Create PR
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

    await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: { agentStatus: 'done', status: 'IN_REVIEW' },
      }),
      prisma.pullRequest.upsert({
        where: { repo_number: { repo: resolvedRepo, number: pr.number } },
        create: {
          workspaceId: task.project.workspaceId,
          taskId,
          repo: resolvedRepo,
          number: pr.number,
          title: `${task.title} [${identifier}]`,
          url: pr.html_url,
          state: 'open',
          authorLogin: 'lumo-agent',
          headBranch: branchName,
          baseBranch: 'main',
        },
        update: { state: 'open', url: pr.html_url, taskId },
      }),
    ])
    await pushAgentEvent(taskId, {
      type: 'agent:done',
      prUrl: pr.html_url,
      prNumber: pr.number,
    })

    // Notify reviewer that task is ready for review
    await notifyTaskInReview({
      workspaceId: task.project.workspaceId,
      taskId,
      reviewerId: task.reviewerId ?? null,
      defaultReviewerId: task.project.defaultReviewerId ?? null,
      actorId: null, // agent action, no Clerk actor
    }).catch(err => console.error('[agent] notifyTaskInReview failed:', err))

    await sandbox.kill().catch(() => {})
  } catch (error) {
    if (timedOut) return

    const current = await prisma.task.findUnique({
      where: { id: taskId },
      select: { agentStatus: true },
    })
    if (
      current?.agentStatus === 'paused' ||
      current?.agentStatus === 'cancelled'
    ) {
      return
    }

    if (error instanceof AgentError) {
      await markFailed(taskId, error.code, error.message)
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error'
      await markFailed(taskId, 'UNKNOWN_ERROR', message)
    }

    await sandbox.kill().catch(() => {})
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }
}
