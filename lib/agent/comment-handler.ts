import { prisma } from '@/lib/db/prisma'
import { isSandboxAlive } from './sandbox-health'
import { getClerkUser } from '@/lib/utils/clerk-helpers'
import { executeAgent } from './execute'
import type { AgentResult } from './execute'
import { getAgentActor, getHumanActorId } from '@/lib/actor'
import { pushTaskEvent, pushUserEvent } from '@/lib/integrations/pusher'
import { transitionAgentStatus } from './state-machine'
import { htmlToMarkdown, markdownToHtml } from '@/lib/utils/markdown'

// ── Mention chip builder ─────────────────────────────────────────────────────

function mentionChip(clerkId: string, displayName: string): string {
  return `<span data-type="mention" data-id="${clerkId}">@${displayName}</span>`
}

// ── Spec helpers (moved from comments/route.ts) ─────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract the instruction text from a comment that mentions an agent.
 * Supports dynamic agent names (e.g. "@Coding Agent", "@Review Agent")
 * as well as the generic "@agent" fallback.
 */
export function extractAgentInstruction(
  commentHtml: string,
  agentNames: string[] = ['Coding Agent']
): string {
  const text = htmlToText(commentHtml)
  const lowerText = text.toLowerCase()

  // Build patterns from agent names + generic fallback
  const patterns = [...agentNames.map(n => `@${n.toLowerCase()}`), '@agent']

  for (const pattern of patterns) {
    const idx = lowerText.indexOf(pattern)
    if (idx !== -1) return text.slice(idx + pattern.length).trim()
  }
  return ''
}

export async function buildAgentSpec(
  taskId: string,
  instruction: string
): Promise<string | null> {
  if (!instruction) return null

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      spec: true,
      description: true,
      branches: { select: { branchName: true }, take: 1 },
      pullRequests: {
        where: { state: 'open' },
        select: { number: true },
        take: 1,
      },
    },
  })
  if (!task) return instruction

  const date = new Date().toISOString().slice(0, 10)

  let contextNote = ''
  if (task.branches.length > 0 || task.pullRequests.length > 0) {
    const parts: string[] = []
    if (task.branches[0])
      parts.push(`branch \`${task.branches[0].branchName}\``)
    if (task.pullRequests[0]) parts.push(`PR #${task.pullRequests[0].number}`)
    contextNote = `\n> Already has ${parts.join(' and ')}. Build on the existing code — do not start from scratch.`
  }

  const section = `\n\n---\n\n**Follow-up instruction (${date}):**\n\n${instruction}${contextNote}`

  if (task.spec) {
    // spec is stored as HTML — convert to markdown, append instruction, convert back
    const specMd = htmlToMarkdown(task.spec)
    return markdownToHtml(specMd + section)
  }

  if (task.description) {
    // description is HTML — build combined spec as HTML
    const descMd = htmlToText(task.description)
    return markdownToHtml(descMd + section)
  }

  return markdownToHtml(instruction + (contextNote ? `\n${contextNote}` : ''))
}

// ── Reply helper ─────────────────────────────────────────────────────────────

async function postAgentReply(params: {
  taskId: string
  parentId: string
  body: string
  agentActorId: string | null
}): Promise<string> {
  const comment = await prisma.comment.create({
    data: {
      taskId: params.taskId,
      authorActorId: params.agentActorId,
      body: params.body,
      parentId: params.parentId,
      type: 'AGENT',
    },
  })
  // Push real-time comment event
  pushTaskEvent(params.taskId, {
    type: 'comment:created',
    commentId: comment.id,
  }).catch(() => {})
  return comment.id
}

// ── Notification helper ──────────────────────────────────────────────────────

async function notifyActor(params: {
  workspaceId: string
  recipientActorId: string
  taskId: string
  commentId: string
  triggerActorId: string | null
}): Promise<void> {
  await prisma.notification.create({
    data: {
      workspaceId: params.workspaceId,
      recipientActorId: params.recipientActorId,
      type: 'TASK_MENTIONED',
      taskId: params.taskId,
      commentId: params.commentId,
      triggerActorId: params.triggerActorId,
    },
  })
}

// ── Main orchestrator ────────────────────────────────────────────────────────

export interface HandleAgentCommentOptions {
  taskId: string
  commentId: string
  commentBody: string
  actorClerkId: string
}

export async function handleAgentComment({
  taskId,
  commentId,
  commentBody,
  actorClerkId,
}: HandleAgentCommentOptions): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      agentStatus: true,
      projectId: true,
      project: { select: { workspaceId: true } },
    },
  })

  if (!task) return

  const { name: actorName, email: actorEmail } =
    await getClerkUser(actorClerkId)
  const workspaceId = task.project.workspaceId
  const agentActorId = await getAgentActor(workspaceId)

  // ── Guard: Task is Done ──────────────────────────────────────────────────
  if (task.status === 'DONE') {
    await postAgentReply({
      taskId,
      parentId: commentId,
      body: `<p>${mentionChip(actorClerkId, actorName)} This task is already done. Reopen it first if you want Agent to make changes.</p>`,
      agentActorId,
    })
    return
  }

  // ── Guard: Agent already running ─────────────────────────────────────────
  if (task.agentStatus === 'WORKING') {
    // Check if there's an active sandbox via AgentRun
    const activeRun = await prisma.agentRun.findFirst({
      where: { taskId, status: 'WORKING' },
      select: { sandboxId: true },
    })
    if (activeRun?.sandboxId) {
      const alive = await isSandboxAlive(activeRun.sandboxId)
      if (alive) {
        await postAgentReply({
          taskId,
          parentId: commentId,
          body: `<p>${mentionChip(actorClerkId, actorName)} Agent is already working on this task. Please wait for it to finish.</p>`,
          agentActorId,
        })
        return
      }
    }
    // Sandbox is dead or no run found — clean up stale state and continue
    await transitionAgentStatus(taskId, task.projectId, 'FAILED', {
      currentStatus: 'WORKING',
    })
  }

  // ── Guard: No GitHub connection ──────────────────────────────────────────
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, clerkId: actorClerkId },
    select: { id: true },
  })

  if (!member) {
    await postAgentReply({
      taskId,
      parentId: commentId,
      body: `<p>${mentionChip(actorClerkId, actorName)} Please connect your GitHub account first: Settings \u2192 Integrations</p>`,
      agentActorId,
    })
    return
  }

  const ghIntegration = await prisma.gitHubIntegration.findUnique({
    where: { workspaceId_memberId: { workspaceId, memberId: member.id } },
    select: { id: true },
  })

  if (!ghIntegration) {
    await postAgentReply({
      taskId,
      parentId: commentId,
      body: `<p>${mentionChip(actorClerkId, actorName)} Please connect your GitHub account first: Settings \u2192 Integrations</p>`,
      agentActorId,
    })
    return
  }

  // ── Post "Got it" reply ──────────────────────────────────────────────────
  await postAgentReply({
    taskId,
    parentId: commentId,
    body: `<p>${mentionChip(actorClerkId, actorName)} Got it. Starting to work on this...</p>`,
    agentActorId,
  })

  // ── Build spec ───────────────────────────────────────────────────────────
  const instruction = extractAgentInstruction(commentBody)
  const updatedSpec = await buildAgentSpec(taskId, instruction)

  // ── Update task ──────────────────────────────────────────────────────────
  await prisma.task.update({
    where: { id: taskId },
    data: {
      assigneeActorId: agentActorId,
      agentStatus: 'SUBMITTED',
      agentError: null,
      ...(updatedSpec !== null ? { spec: updatedSpec } : {}),
    },
  })

  // ── Execute agent ────────────────────────────────────────────────────────
  let result: AgentResult
  try {
    result = await executeAgent({
      taskId,
      actorClerkId,
      actorName,
      actorEmail,
      trigger: 'comment',
    })
  } catch (err) {
    console.error('[comment-handler] executeAgent threw:', err)
    result = {
      outcome: 'failed',
      error: 'Something went wrong. Please try again.',
    }
  }

  // ── Post completion reply ────────────────────────────────────────────────
  let replyBody: string

  switch (result.outcome) {
    case 'done':
      replyBody = `<p>${mentionChip(actorClerkId, actorName)} Done! PR #${result.prNumber} is ready for review:<br/><a href="${result.prUrl}">${result.prUrl}</a></p>`
      break
    case 'failed':
      replyBody = `<p>${mentionChip(actorClerkId, actorName)} Failed to complete the task: ${result.error}<br/>You can retry in the task detail page.</p>`
      break
    case 'clarify':
      replyBody = `<p>${mentionChip(actorClerkId, actorName)} I need clarification before continuing:<br/>${result.question}</p>`
      break
    case 'no_changes':
      replyBody = `<p>${mentionChip(actorClerkId, actorName)} Agent finished but made no changes. Please add more details to the spec or description.</p>`
      break
    case 'spec_review':
      replyBody = `<p>${mentionChip(actorClerkId, actorName)} A spec has been generated and is ready for your review in the task detail page.</p>`
      break
    default:
      replyBody = `<p>${mentionChip(actorClerkId, actorName)} Agent finished with an unexpected status.</p>`
      break
  }

  const completionReplyId = await postAgentReply({
    taskId,
    parentId: commentId,
    body: replyBody,
    agentActorId,
  })

  // ── Notify actor ─────────────────────────────────────────────────────────
  const actorHumanActorId = await getHumanActorId(member.id)
  if (actorHumanActorId) {
    await notifyActor({
      workspaceId,
      recipientActorId: actorHumanActorId,
      taskId,
      commentId: completionReplyId,
      triggerActorId: agentActorId,
    }).catch(err =>
      console.error('[comment-handler] notification failed:', err)
    )
    // Push real-time notification to the user
    pushUserEvent(actorClerkId, { type: 'notification:new' }).catch(() => {})
  }
}
