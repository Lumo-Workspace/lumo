import { memoryRepository } from '@/lib/repositories/memory.repository'
import { getLayer2Input } from './layer2-input'
import { extractLayer2Operations } from './layer2-extract'
import { applyLayer2Operations } from './layer2-apply'

interface ProjectResult {
  projectId: string
  added: number
  updated: number
  noop: number
  skipped: number
  error?: string
}

export interface Layer2RunResult {
  projects: ProjectResult[]
  /** Project ids the run skipped (no input — e.g. missing project, no TASK memories). */
  skippedProjects: string[]
}

/**
 * Periodic memory consolidation. Enumerates every project that has at
 * least one TASK-scope memory, then runs the
 *   getLayer2Input → extractLayer2Operations → applyLayer2Operations
 * pipeline once per project. Each project's failure is isolated so one
 * broken project doesn't block the rest of the run.
 *
 * Designed to be called from a cron route. Returns a structured summary so
 * the route can render it in the response (and so it shows up in logs).
 */
export const layer2Service = {
  async runConsolidation(): Promise<Layer2RunResult> {
    const projectIds =
      await memoryRepository.findProjectIdsWithTaskScopeMemory()

    console.log(`[memory.layer2] starting run projects=${projectIds.length}`)

    const projects: ProjectResult[] = []
    const skippedProjects: string[] = []

    for (const projectId of projectIds) {
      try {
        const input = await getLayer2Input(projectId)
        if (!input) {
          skippedProjects.push(projectId)
          continue
        }

        const operations = await extractLayer2Operations(input)
        if (operations.length === 0) {
          // Extraction degraded to empty list (LLM failure or empty result).
          // Record as a zero-result run rather than skipping silently.
          projects.push({
            projectId,
            added: 0,
            updated: 0,
            noop: 0,
            skipped: 0,
          })
          continue
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

        projects.push({
          projectId,
          added: result.added,
          updated: result.updated,
          noop: result.noop,
          skipped: result.skipped,
        })

        console.log(`[memory.layer2] applied project=${projectId}`, result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        projects.push({
          projectId,
          added: 0,
          updated: 0,
          noop: 0,
          skipped: 0,
          error: message,
        })
        console.error(
          `[memory.layer2] project failed project=${projectId}:`,
          error
        )
      }
    }

    console.log(
      `[memory.layer2] run complete projects=${projects.length} skipped=${skippedProjects.length}`
    )

    return { projects, skippedProjects }
  },
}
