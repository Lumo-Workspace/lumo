import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent, pushProjectEvent } from '@/lib/pusher/server'

const SPEC_SYSTEM_PROMPT = `You are a technical spec writer for a software engineering team.
Given a task title and description, produce a concise implementation spec in Markdown.

Structure your spec with these sections (omit any that don't apply):
## Requirements
(Bullet list of concrete functional requirements)

## Implementation Notes
(Key technical decisions, libraries to use, patterns to follow)

## Test Cases
(Important scenarios that need to be covered)

## Open Questions
(Anything that needs clarification before coding — be specific)

Keep it focused and actionable. Write for the engineer who will implement this, not for a business audience.
Respond with ONLY the Markdown content — no preamble, no "Here is your spec:" prefix.`

export async function generateSpecDraft(
  taskId: string,
  task: {
    title: string
    description: string | null
    spec: string | null
    project: {
      id: string
      workspaceId: string
      defaultReviewerId: string | null
    }
    reviewerActorId: string | null
  }
): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  await prisma.task.update({
    where: { id: taskId },
    data: { agentStatus: 'RUNNING', agentError: null },
  })
  await pushAgentEvent(taskId, { type: 'agent:started' })
  await pushProjectEvent(task.project.id, {
    type: 'task:updated',
    taskId,
    fields: ['agentStatus'],
    patch: { agentStatus: 'RUNNING' },
  })
  await pushAgentEvent(taskId, {
    type: 'agent:progress',
    message: 'Generating spec from description…',
  })

  const client = new Anthropic({ apiKey: anthropicKey })

  const userContent = `Task: ${task.title}\n\nDescription:\n${task.description ?? '(no description provided)'}`

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    system: SPEC_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })

  const specText =
    message.content[0]?.type === 'text' ? message.content[0].text.trim() : ''

  if (!specText) {
    await prisma.task.update({
      where: { id: taskId },
      data: { agentStatus: 'FAILED', agentError: 'SPEC_GEN_EMPTY' },
    })
    await pushAgentEvent(taskId, {
      type: 'agent:failed',
      error:
        'Spec generation returned empty output. Please add more detail to the description and retry.',
    })
    await pushProjectEvent(task.project.id, {
      type: 'task:updated',
      taskId,
      fields: ['agentStatus'],
      patch: { agentStatus: 'FAILED' },
    })
    return
  }

  // Save the generated spec and set status to spec_review
  await prisma.task.update({
    where: { id: taskId },
    data: { spec: specText, agentStatus: 'SPEC_REVIEW' },
  })

  await pushAgentEvent(taskId, { type: 'agent:spec_draft', spec: specText })
  await pushProjectEvent(task.project.id, {
    type: 'task:updated',
    taskId,
    fields: ['agentStatus'],
    patch: { agentStatus: 'SPEC_REVIEW' },
  })

  // Send Inbox notification to reviewer
  // Resolve effective reviewer Actor ID: task reviewer actor → or default reviewer (member → actor)
  let effectiveReviewerActorId: string | null = task.reviewerActorId ?? null
  if (!effectiveReviewerActorId && task.project.defaultReviewerId) {
    const reviewerActor = await prisma.actor.findUnique({
      where: { memberId: task.project.defaultReviewerId },
      select: { id: true },
    })
    effectiveReviewerActorId = reviewerActor?.id ?? null
  }

  if (effectiveReviewerActorId) {
    await prisma.notification.create({
      data: {
        workspaceId: task.project.workspaceId,
        recipientActorId: effectiveReviewerActorId,
        type: 'TASK_SPEC_READY',
        taskId,
        triggerActorId: null,
      },
    })
  } else {
    // Fall back to workspace owners
    const ownerActors = await prisma.actor.findMany({
      where: {
        workspaceId: task.project.workspaceId,
        type: 'HUMAN',
        member: { role: 'OWNER' },
      },
      select: { id: true },
    })
    if (ownerActors.length > 0) {
      await prisma.notification.createMany({
        data: ownerActors.map(a => ({
          workspaceId: task.project.workspaceId,
          recipientActorId: a.id,
          type: 'TASK_SPEC_READY' as const,
          taskId,
          triggerActorId: null,
        })),
      })
    }
  }
}
