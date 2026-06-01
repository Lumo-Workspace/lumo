import { getLayer1Input } from './layer1-input'
import { extractLayer1Operations } from './layer1-extract'
import { applyLayer1Operations } from './layer1-apply'

interface TriggerLayer1Input {
  sessionId: string
  taskId: string | null
  workspaceId: string
}

/**
 * Fire-and-forget entrypoint invoked from the Stop hook handler. Owns its own
 * error handling — must never throw, since the caller (the hook route) has
 * already returned 200 to the client by the time this runs under
 * `waitUntil(...)`.
 *
 * Day-2 scope: task-scoped memory only. When there's no task tag we skip
 * (project-scoped extraction is deferred). The pipeline is:
 *   getLayer1Input → extractLayer1Operations → applyLayer1Operations
 * Each step degrades to a no-op on failure rather than propagating.
 */
export const layer1Service = {
  async triggerLayer1Extraction(input: TriggerLayer1Input): Promise<void> {
    try {
      if (!input.taskId) {
        console.log(
          `[memory.layer1] skip session=${input.sessionId} reason=no-task-tag`
        )
        return
      }

      console.log(
        `[memory.layer1] triggered session=${input.sessionId} task=${input.taskId}`
      )

      const layer1Input = await getLayer1Input(input.sessionId, input.taskId)
      if (!layer1Input) {
        console.log(
          `[memory.layer1] skip session=${input.sessionId} reason=no-input`
        )
        return
      }

      const operations = await extractLayer1Operations(layer1Input)
      if (operations.length === 0) {
        console.log(
          `[memory.layer1] no-ops session=${input.sessionId} (LLM returned empty list)`
        )
        return
      }

      const result = await applyLayer1Operations({
        operations,
        taskId: layer1Input.task.id,
        projectId: layer1Input.task.projectId,
        workspaceId: layer1Input.task.workspaceId,
        sessionId: input.sessionId,
        ...(layer1Input.agent !== undefined
          ? { agent: layer1Input.agent }
          : {}),
        existingMemories: layer1Input.existingMemories.map(m => ({
          id: m.id,
          category: m.category,
        })),
      })

      console.log(
        `[memory.layer1] applied session=${input.sessionId} task=${input.taskId}`,
        result
      )
    } catch (error) {
      console.error(
        `[memory.layer1] unexpected error session=${input.sessionId}:`,
        error
      )
    }
  },
}
