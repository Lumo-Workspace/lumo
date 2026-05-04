import { getLayer2Input } from './layer2-input'
import { extractLayer2Facts, type Layer2Fact } from './layer2-extract'

export interface ConsolidateResult {
  /**
   * `null` means the task or its memories are gone — caller should skip
   * Layer 3 entirely. An empty array means Layer 2 ran successfully and
   * decided nothing generalizes (still skip Layer 3, but the task is real).
   */
  facts: Layer2Fact[] | null
  task: {
    id: string
    projectId: string
    workspaceId: string
  } | null
}

export const layer2Service = {
  /**
   * Distill the active task-scoped memories of a finished task into
   * project-level facts. Returns `{ facts: null, task: null }` when the task
   * has no input (gone, or no active task memory). Otherwise returns the
   * distilled facts (possibly empty) plus the IDs Layer 3 needs.
   *
   * Owns its own error handling for LLM failures (degrades to empty facts)
   * but does not catch repository errors — callers run inside try/catch.
   */
  async consolidateTaskMemory(taskId: string): Promise<ConsolidateResult> {
    const input = await getLayer2Input(taskId)
    if (!input) {
      return { facts: null, task: null }
    }

    const facts = await extractLayer2Facts(input)
    return {
      facts,
      task: {
        id: input.task.id,
        projectId: input.task.projectId,
        workspaceId: input.task.workspaceId,
      },
    }
  },
}
