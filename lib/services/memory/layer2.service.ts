import { getLayer2Input } from './layer2-input'
import { extractLayer2Operations } from './layer2-extract'
import { applyLayer2Operations } from './layer2-apply'

export interface Layer2ProjectResult {
  added: number
  updated: number
  noop: number
  skipped: number
}

interface TriggerForTaskCompletionInput {
  taskId: string
  projectId: string
}

/**
 * Layer 2 memory consolidation: scans recent TASK-scope memories in a
 * project, identifies recurring lessons, and promotes them to PROJECT
 * scope via the
 *   getLayer2Input → extractLayer2Operations → applyLayer2Operations
 * pipeline.
 *
 * Triggered when a task transitions to DONE — that's the natural moment
 * for the lesson to sediment, and it gives the next agent on a sibling
 * task immediate access to the promoted memory. The previous cron-based
 * trigger was retired in LUM-72; the event-driven trigger uses the same
 * `waitUntil` fire-and-forget pattern as Layer 1.
 */
export const layer2Service = {
  /**
   * Fire-and-forget entrypoint invoked when a task transitions to DONE.
   * Owns its own error handling — must never throw, since the caller wraps
   * this in `waitUntil(...)` after returning the HTTP response.
   *
   * Multiple completions on the same project in quick succession will each
   * fire a run. Layer 2 is idempotent (the LLM sees existing PROJECT
   * memories and emits NOOP/UPDATE when a pattern is already represented),
   * so back-to-back runs converge without duplication. v1 deliberately
   * skips debouncing because the haiku call is cheap; revisit if logs show
   * sustained burst patterns.
   */
  async triggerForTaskCompletion(
    input: TriggerForTaskCompletionInput
  ): Promise<void> {
    try {
      console.log(
        `[memory.layer2] triggered task=${input.taskId} project=${input.projectId}`
      )
      await runForProject(input.projectId)
    } catch (error) {
      console.error(
        `[memory.layer2] unexpected error project=${input.projectId}:`,
        error
      )
    }
  },

  /**
   * Run the consolidation pipeline once for a single project. Exposed so
   * tests and any future maintenance tool (e.g. an admin reprocess) can
   * call it directly. Returns null when the project has nothing to
   * consolidate (no TASK memories or project missing).
   */
  async runForProject(projectId: string): Promise<Layer2ProjectResult | null> {
    return runForProject(projectId)
  },
}

async function runForProject(
  projectId: string
): Promise<Layer2ProjectResult | null> {
  const input = await getLayer2Input(projectId)
  if (!input) {
    console.log(`[memory.layer2] skip project=${projectId} reason=no-input`)
    return null
  }

  const operations = await extractLayer2Operations(input)
  if (operations.length === 0) {
    console.log(
      `[memory.layer2] no-ops project=${projectId} (LLM returned empty list)`
    )
    return { added: 0, updated: 0, noop: 0, skipped: 0 }
  }

  const result = await applyLayer2Operations({
    operations,
    projectId: input.project.id,
    workspaceId: input.project.workspaceId,
    existingProjectMemories: input.existingProjectMemories.map(m => ({
      id: m.id,
      category: m.category,
    })),
  })

  console.log(`[memory.layer2] applied project=${projectId}`, result)

  return {
    added: result.added,
    updated: result.updated,
    noop: result.noop,
    skipped: result.skipped,
  }
}
