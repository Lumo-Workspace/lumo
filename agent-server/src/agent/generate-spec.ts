import Anthropic from '@anthropic-ai/sdk'
import { pushAgentEvent, fireAgentEvent } from '../pusher/server.js'
import { transitionAgentStatus } from './state-machine.js'
import { markdownToHtml } from './markdown.js'
import { prisma } from '../db/prisma.js'

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
    project: { id: string }
  }
): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

  await transitionAgentStatus(taskId, task.project.id, 'WORKING', {
    agentError: null,
  })
  const lastRun = await prisma.agentRun.findFirst({
    where: { taskId },
    orderBy: { runNumber: 'desc' },
    select: { runNumber: true },
  })
  fireAgentEvent(taskId, {
    type: 'agent:started',
    runNumber: lastRun?.runNumber ?? 0,
  })
  fireAgentEvent(taskId, {
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
    await transitionAgentStatus(taskId, task.project.id, 'FAILED', {
      agentError: 'SPEC_GEN_EMPTY',
    })
    await pushAgentEvent(taskId, {
      type: 'agent:failed',
      error:
        'Spec generation returned empty output. Please add more detail to the description and retry.',
    })
    return
  }

  const specHtml = markdownToHtml(specText)

  await transitionAgentStatus(taskId, task.project.id, 'INPUT_REQUIRED', {
    spec: specHtml,
    inputReason: 'spec_review',
  })

  await pushAgentEvent(taskId, { type: 'agent:spec_draft', spec: specHtml })
}
