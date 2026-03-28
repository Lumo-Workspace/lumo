import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { getGithubInstallationToken } from '@/lib/github/auth'
import { monitorForClarify } from './clarify-monitor'
import { pushAgentEvent } from '@/lib/pusher/server'

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
    const error = await response.json()
    throw new Error(`Failed to create PR: ${JSON.stringify(error)}`)
  }

  return response.json() as Promise<{ html_url: string; number: number }>
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
      project: {
        select: {
          id: true,
          name: true,
          workspaceId: true,
          githubRepo: true,
          defaultReviewerId: true,
        },
      },
    },
  })

  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!task.project.githubRepo) {
    throw new Error(`Task ${taskId} has no GitHub repo configured`)
  }

  const githubToken = await getGithubInstallationToken()

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const [repoOwner, repoName] = task.project.githubRepo.split('/')
  if (!repoOwner || !repoName) {
    throw new Error(`Invalid githubRepo format: ${task.project.githubRepo}`)
  }

  const identifier = `LUM-${task.number}`
  const branchName = `lumo/${identifier}-${slugify(task.title)}`
  const taskSpec = task.spec ?? task.description ?? task.title

  await prisma.task.update({
    where: { id: taskId },
    data: { agentStatus: 'running' },
  })
  await pushAgentEvent(taskId, { type: 'agent:started' })

  const sandbox = await Sandbox.create({ timeoutMs: 30 * 60 * 1000 })

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
    await sandbox.commands.run(
      `git clone https://oauth2:${githubToken}@github.com/${repoOwner}/${repoName} /home/user/repo` +
        ` && git -C /home/user/repo config user.email "agent@uselumo.ai"` +
        ` && git -C /home/user/repo config user.name "Lumo Agent"`,
      { timeoutMs: 2 * 60 * 1000 }
    )

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
        .then(r => r),
      monitorForClarify(sandbox, monitorTask).then(() => CLARIFY_SENTINEL),
    ])

    if (winner === CLARIFY_SENTINEL) {
      const q = await prisma.task.findUnique({
        where: { id: taskId },
        select: { clarifyQuestion: true, clarifyContext: true },
      })
      await pushAgentEvent(taskId, {
        type: 'agent:clarify',
        question: q?.clarifyQuestion ?? '',
        context: q?.clarifyContext ?? null,
      })
      return
    }

    const result = winner as Awaited<ReturnType<typeof sandbox.commands.run>>
    if (result.exitCode !== 0) {
      throw new Error(
        `Agent failed (exit ${result.exitCode}): ${result.stderr}`
      )
    }

    // Check if agent made any commits — no commits means nothing to PR
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
    const push = await sandbox.commands.run(
      `git -C /home/user/repo push origin ${branchName}`,
      { timeoutMs: 60 * 1000 }
    )
    if (push.exitCode !== 0) {
      throw new Error(`Push failed: ${push.stderr}`)
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

    await prisma.task.update({
      where: { id: taskId },
      data: {
        agentStatus: 'done',
        status: 'IN_REVIEW',
        githubPrUrl: pr.html_url,
        githubPrNumber: pr.number,
        githubPrStatus: 'open',
      },
    })
    await pushAgentEvent(taskId, {
      type: 'agent:done',
      prUrl: pr.html_url,
      prNumber: pr.number,
    })

    await sandbox.kill().catch(() => {})
  } catch (error) {
    const current = await prisma.task.findUnique({
      where: { id: taskId },
      select: { agentStatus: true },
    })
    if (current?.agentStatus !== 'paused') {
      const message = error instanceof Error ? error.message : 'Unknown error'
      await prisma.task.update({
        where: { id: taskId },
        data: { agentStatus: 'failed' },
      })
      await pushAgentEvent(taskId, { type: 'agent:failed', error: message })
      await sandbox.kill().catch(() => {})
    }
    throw error
  }
}
