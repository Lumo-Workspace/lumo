import { taskService } from '@/lib/services/task.service'
import { taskCliService } from '@/lib/services/task-cli.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { appendDecision } from '@/lib/task-templates/decisions'

/**
 * LUM-970: `lumo task decide <id> "<text>"` — append a ruling to the task
 * brief's `## Decisions` section (created when missing) instead of scattering
 * it across comments. The write goes through the normal CLI update path, so
 * history / activity / revision tracking see an ordinary description edit.
 */
async function appendToTask(args: {
  workspaceId: string
  workspaceSlug: string
  callerClerkId: string
  identifier: string
  text: string
  sourceSessionId?: string | null
}) {
  const resolved = await taskService.resolveIdentifier(
    args.workspaceId,
    args.identifier
  )
  if (!resolved) {
    throw Object.assign(new Error(`Task ${args.identifier} not found`), {
      status: 404,
    })
  }
  const current = await taskRepository.findDescription(resolved.id)
  const description = appendDecision(current?.description ?? null, args.text)
  return taskCliService.updateFromCli({
    workspaceId: args.workspaceId,
    workspaceSlug: args.workspaceSlug,
    callerClerkId: args.callerClerkId,
    identifier: args.identifier,
    sourceSessionId: args.sourceSessionId ?? null,
    input: { description },
  })
}

export const taskDecisionService = { appendToTask }
