import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { getActorClerkId } from '@/lib/actor'
import { pushUserEvent } from '@/lib/integrations/pusher'
import { shouldNotify } from '@/lib/notifications/preferenceGate'

// ── Shared helpers ────────────────────────────────────────────────────────────

interface TaskForNotify {
  assigneeActorId: string | null
  reviewerActorId: string | null
  team: { workspace: { id: string } }
  project: { ownerId: string | null }
}

async function loadTask(taskId: string): Promise<TaskForNotify | null> {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      assigneeActorId: true,
      reviewerActorId: true,
      team: { select: { workspace: { select: { id: true } } } },
      project: { select: { ownerId: true } },
    },
  })
}

/** Send notification to a single actor and push a realtime event. */
async function createAndPush(params: {
  workspaceId: string
  recipientActorId: string
  triggerActorId: string | null
  type: Parameters<typeof prisma.notification.create>[0]['data']['type']
  taskId: string
  clarifyId?: string | null
  requiresAction?: boolean
}): Promise<void> {
  const sendInApp = await shouldNotify(
    params.recipientActorId,
    'inApp',
    params.type
  )
  if (!sendInApp) return

  await prisma.notification.create({
    data: {
      workspaceId: params.workspaceId,
      recipientActorId: params.recipientActorId,
      triggerActorId: params.triggerActorId,
      type: params.type,
      taskId: params.taskId,
      clarifyId: params.clarifyId ?? null,
      requiresAction: params.requiresAction ?? false,
    },
  })
  const clerkId = await getActorClerkId(params.recipientActorId)
  if (clerkId) {
    waitUntil(pushUserEvent(clerkId, { type: 'notification:new' }))
  }
}

/**
 * Resolve the actor to notify for agent interactions targeting the assignee.
 * Returns the assignee actor ID if it belongs to a human; otherwise falls back
 * to workspace owners.
 */
async function resolveAssigneeActorId(
  assigneeActorId: string | null,
  workspaceId: string
): Promise<string[]> {
  if (assigneeActorId) {
    const actor = await prisma.actor.findUnique({
      where: { id: assigneeActorId },
      select: { type: true },
    })
    if (actor?.type === 'HUMAN') return [assigneeActorId]
  }
  // Fall back to workspace owners
  const owners = await prisma.actor.findMany({
    where: { workspaceId, type: 'HUMAN', member: { role: 'OWNER' } },
    select: { id: true },
  })
  return owners.map(o => o.id)
}

/**
 * Resolve the actor to notify for agent verify / reviewer-targeted events.
 * Tries reviewerActorId, then project.ownerId (member → actor),
 * then falls back to workspace owners.
 */
async function resolveReviewerActorId(
  reviewerActorId: string | null,
  ownerMemberId: string | null,
  workspaceId: string
): Promise<string[]> {
  if (reviewerActorId) return [reviewerActorId]

  if (ownerMemberId) {
    const actor = await prisma.actor.findUnique({
      where: { memberId: ownerMemberId },
      select: { id: true },
    })
    if (actor) return [actor.id]
  }

  const owners = await prisma.actor.findMany({
    where: { workspaceId, type: 'HUMAN', member: { role: 'OWNER' } },
    select: { id: true },
  })
  return owners.map(o => o.id)
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Notify the task assignee (or owners) that the agent needs clarification.
 * Sends an AGENT_CLARIFY notification (requiresAction=true).
 *
 * Called from clarify-monitor.ts after the AgentClarify record is created.
 */
export async function notifyAgentClarify(
  taskId: string,
  clarifyId: string,
  triggerActorId: string | null = null
): Promise<void> {
  const task = await loadTask(taskId)
  if (!task) return

  const recipients = await resolveAssigneeActorId(
    task.assigneeActorId,
    task.team.workspace.id
  )
  for (const recipientActorId of recipients) {
    await createAndPush({
      workspaceId: task.team.workspace.id,
      recipientActorId,
      triggerActorId,
      type: 'AGENT_CLARIFY',
      taskId,
      clarifyId,
      requiresAction: true,
    })
  }
}

/**
 * Notify the task reviewer (or owners) that agent work is ready for verification.
 * Sends an AGENT_VERIFY notification (requiresAction=true).
 *
 * Called from execute.ts after completeAgentRun succeeds.
 */
export async function notifyAgentVerify(
  taskId: string,
  agentActorId: string | null = null
): Promise<void> {
  const task = await loadTask(taskId)
  if (!task) return

  const recipients = await resolveReviewerActorId(
    task.reviewerActorId,
    task.project.ownerId,
    task.team.workspace.id
  )
  // Don't notify the agent itself
  const filtered = recipients.filter(id => id !== agentActorId)
  for (const recipientActorId of filtered) {
    await createAndPush({
      workspaceId: task.team.workspace.id,
      recipientActorId,
      triggerActorId: agentActorId,
      type: 'AGENT_VERIFY',
      taskId,
      requiresAction: true,
    })
  }
}

/**
 * Notify the task assignee (or owners) that the agent failed.
 * Sends an AGENT_FAILED notification (informational).
 *
 * Called from markFailed in execute.ts.
 */
export async function notifyAgentFailed(
  taskId: string,
  agentActorId: string | null = null
): Promise<void> {
  const task = await loadTask(taskId)
  if (!task) return

  const recipients = await resolveAssigneeActorId(
    task.assigneeActorId,
    task.team.workspace.id
  )
  const filtered = recipients.filter(id => id !== agentActorId)
  for (const recipientActorId of filtered) {
    await createAndPush({
      workspaceId: task.team.workspace.id,
      recipientActorId,
      triggerActorId: agentActorId,
      type: 'AGENT_FAILED',
      taskId,
    })
  }
}

/**
 * Notify the task assignee (or owners) that the agent completed successfully.
 * Sends an AGENT_DONE notification (informational).
 */
export async function notifyAgentDone(
  taskId: string,
  agentActorId: string | null = null
): Promise<void> {
  const task = await loadTask(taskId)
  if (!task) return

  const recipients = await resolveAssigneeActorId(
    task.assigneeActorId,
    task.team.workspace.id
  )
  const filtered = recipients.filter(id => id !== agentActorId)
  for (const recipientActorId of filtered) {
    await createAndPush({
      workspaceId: task.team.workspace.id,
      recipientActorId,
      triggerActorId: agentActorId,
      type: 'AGENT_DONE',
      taskId,
    })
  }
}
