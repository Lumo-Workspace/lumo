/**
 * ContextBuilder — assembles rich context for agent execution.
 */

import { prisma } from '../db/prisma.js'
import { htmlToMarkdown } from './markdown.js'

const CHARS_PER_TOKEN = 4
const DEFAULT_TOKEN_BUDGET = 8000

interface ContextSection {
  label: string
  priority: number
  content: string
  tokens: number
}

interface ContextBuilderOptions {
  taskId: string
  branchName: string
  identifier: string
  tokenBudget?: number
}

async function fetchTaskContext(taskId: string) {
  return prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      comments: {
        select: {
          id: true,
          body: true,
          type: true,
          createdAt: true,
          author: { select: { type: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 30,
      },
      clarifies: {
        select: {
          question: true,
          context: true,
          reply: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      },
      agentRuns: {
        select: {
          runNumber: true,
          status: true,
          trigger: true,
          summary: true,
          errorMessage: true,
          branchName: true,
          prUrl: true,
          durationMs: true,
          startedAt: true,
          finishedAt: true,
        },
        orderBy: { runNumber: 'desc' },
        take: 10,
      },
      pullRequests: {
        where: { state: { in: ['open', 'merged'] } },
        select: {
          number: true,
          url: true,
          state: true,
          ciStatus: true,
          title: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      project: {
        select: {
          name: true,
          description: true,
        },
      },
      parent: {
        select: {
          title: true,
          children: {
            select: { id: true, title: true, status: true },
            take: 10,
          },
        },
      },
      children: {
        select: { id: true, title: true, status: true },
        take: 10,
      },
    },
  })
}

type TaskContext = Awaited<ReturnType<typeof fetchTaskContext>>

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function buildTaskCoreSection(ctx: TaskContext): ContextSection {
  const lines: string[] = []
  lines.push(`# Task: ${ctx.title}`)
  lines.push(`Priority: ${ctx.priority}`)
  lines.push(`Status: ${ctx.status}`)
  lines.push('')

  if (ctx.spec) {
    lines.push('## Spec')
    lines.push(htmlToMarkdown(ctx.spec))
    lines.push('')
  }

  if (ctx.description) {
    lines.push('## Description')
    lines.push(htmlToMarkdown(ctx.description))
    lines.push('')
  }

  const content = lines.join('\n')
  return {
    label: 'Task',
    priority: 0,
    content,
    tokens: estimateTokens(content),
  }
}

function buildCommentsSection(ctx: TaskContext): ContextSection | null {
  const comments = ctx.comments
  if (comments.length === 0) return null

  const lines: string[] = ['## Comments']
  for (const c of comments) {
    const author = c.type === 'AGENT' ? 'Agent' : 'Team member'
    const date = c.createdAt.toISOString().slice(0, 10)
    const body = htmlToMarkdown(c.body).trim()
    const truncated = body.length > 500 ? body.slice(0, 497) + '...' : body
    lines.push(`**${author}** (${date}):`)
    lines.push(truncated)
    lines.push('')
  }

  const content = lines.join('\n')
  return {
    label: 'Comments',
    priority: 1,
    content,
    tokens: estimateTokens(content),
  }
}

function buildClarificationsSection(ctx: TaskContext): ContextSection | null {
  const clarifies = ctx.clarifies.filter(c => c.reply)
  if (clarifies.length === 0) return null

  const lines: string[] = ['## Clarifications']
  for (const c of clarifies) {
    lines.push(`**Q:** ${c.question}`)
    if (c.context) lines.push(`_Context:_ ${c.context}`)
    lines.push(`**A:** ${c.reply}`)
    lines.push('')
  }

  const content = lines.join('\n')
  return {
    label: 'Clarifications',
    priority: 2,
    content,
    tokens: estimateTokens(content),
  }
}

function buildAgentRunHistorySection(ctx: TaskContext): ContextSection | null {
  const pastRuns = ctx.agentRuns.slice(1)
  if (pastRuns.length === 0) return null

  const STATUS_LABEL: Record<string, string> = {
    COMPLETED: 'Done',
    FAILED: 'Failed',
    CANCELED: 'Cancelled',
    WORKING: 'Running',
    SUBMITTED: 'Submitted',
    INPUT_REQUIRED: 'Paused',
  }

  const lines: string[] = ['## Past Agent Runs']
  for (const run of pastRuns) {
    const status = STATUS_LABEL[run.status] ?? run.status
    const trigger = run.trigger ?? 'unknown'
    const duration = run.durationMs
      ? `${Math.round(run.durationMs / 1000)}s`
      : 'n/a'
    lines.push(
      `- **Run #${run.runNumber}** [${status}] trigger=${trigger} duration=${duration}`
    )
    if (run.summary) {
      const summary =
        run.summary.length > 300
          ? run.summary.slice(0, 297) + '...'
          : run.summary
      lines.push(`  Summary: ${summary}`)
    }
    if (run.errorMessage) lines.push(`  Error: ${run.errorMessage}`)
    if (run.prUrl) lines.push(`  PR: ${run.prUrl}`)
  }
  lines.push('')

  const content = lines.join('\n')
  return {
    label: 'Agent Run History',
    priority: 3,
    content,
    tokens: estimateTokens(content),
  }
}

function buildPRFeedbackSection(ctx: TaskContext): ContextSection | null {
  if (ctx.pullRequests.length === 0) return null

  const lines: string[] = ['## Pull Requests']
  for (const pr of ctx.pullRequests) {
    const ci = pr.ciStatus ? ` CI: ${pr.ciStatus}` : ''
    lines.push(`- PR #${pr.number}: ${pr.title} [${pr.state}]${ci}`)
    lines.push(`  ${pr.url}`)
  }
  lines.push('')

  const content = lines.join('\n')
  return {
    label: 'PR Feedback',
    priority: 4,
    content,
    tokens: estimateTokens(content),
  }
}

function buildProjectContextSection(ctx: TaskContext): ContextSection | null {
  if (!ctx.project.description) return null

  const lines: string[] = ['## Project Context']
  lines.push(`Project: ${ctx.project.name}`)
  if (ctx.project.description) {
    const desc = htmlToMarkdown(ctx.project.description).trim()
    const truncated = desc.length > 500 ? desc.slice(0, 497) + '...' : desc
    lines.push(truncated)
  }
  lines.push('')

  const content = lines.join('\n')
  return {
    label: 'Project Context',
    priority: 5,
    content,
    tokens: estimateTokens(content),
  }
}

function buildRelatedTasksSection(ctx: TaskContext): ContextSection | null {
  const related: { id: string; title: string; status: string }[] = []

  if (ctx.parent) {
    for (const child of ctx.parent.children) {
      if (child.id !== ctx.id) related.push(child)
    }
  }
  for (const child of ctx.children) {
    related.push(child)
  }

  if (related.length === 0) return null

  const lines: string[] = ['## Related Tasks']
  if (ctx.parent) lines.push(`Parent: ${ctx.parent.title}`)
  for (const t of related.slice(0, 10)) {
    lines.push(`- [${t.status}] ${t.title}`)
  }
  lines.push('')

  const content = lines.join('\n')
  return {
    label: 'Related Tasks',
    priority: 6,
    content,
    tokens: estimateTokens(content),
  }
}

function buildInstructionsSection(
  identifier: string,
  branchName: string
): ContextSection {
  const content = `## Instructions
- Read CLAUDE.md first for project conventions
- Branch is already created: ${branchName}
- Commit your changes when done; include [${identifier}] in the commit message
- Do NOT add Co-Authored-By or any AI attribution lines to commit messages
- Push your branch when done: \`git push origin ${branchName}\`
- Do NOT create a PR (handled automatically)

## Clarification Protocol
If the spec is ambiguous, missing critical details, or you are unsure how to proceed,
you MUST ask for clarification instead of guessing. To do so:
- Call the \`mcp__lumo-sandbox__ask_user\` tool with your question and context.
  IMPORTANT: Use exactly this tool name — do NOT use AskUserQuestion or any other tool.
- The tool will BLOCK and wait for the user's reply (this may take minutes).
- Once you receive the reply, continue working based on the answer.
- Do NOT stop or exit after calling mcp__lumo-sandbox__ask_user — just wait for the response.`

  return {
    label: 'Instructions',
    priority: 0,
    content,
    tokens: estimateTokens(content),
  }
}

function assembleSections(
  sections: ContextSection[],
  tokenBudget: number
): string {
  const sorted = [...sections].sort((a, b) => a.priority - b.priority)
  const included: string[] = []
  let remaining = tokenBudget

  for (const section of sorted) {
    if (section.tokens <= remaining) {
      included.push(section.content)
      remaining -= section.tokens
    }
  }

  return included.join('\n')
}

export async function buildAgentContext(
  options: ContextBuilderOptions
): Promise<string> {
  const {
    taskId,
    branchName,
    identifier,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
  } = options

  const ctx = await fetchTaskContext(taskId)

  const candidates: ContextSection[] = [
    buildTaskCoreSection(ctx),
    buildInstructionsSection(identifier, branchName),
  ]

  const optional = [
    buildCommentsSection(ctx),
    buildClarificationsSection(ctx),
    buildAgentRunHistorySection(ctx),
    buildPRFeedbackSection(ctx),
    buildProjectContextSection(ctx),
    buildRelatedTasksSection(ctx),
  ]

  for (const section of optional) {
    if (section) candidates.push(section)
  }

  return assembleSections(candidates, tokenBudget)
}
