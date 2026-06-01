import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MemoryCategory } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'

export interface Layer2Input {
  project: {
    id: string
    name: string
    workspaceId: string
  }
  /**
   * Recent TASK-scope memories in the project, grouped by source task. The
   * LLM uses the "this lesson appeared in N different tasks" signal to
   * decide whether a pattern should be promoted to PROJECT scope.
   */
  taskMemories: Array<{
    id: string
    taskId: string
    category: MemoryCategory
    content: unknown
  }>
  /** Existing PROJECT-scope memories — feeds NOOP / UPDATE dedup decisions. */
  existingProjectMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
  /**
   * The project constitution — CLAUDE.md / AGENTS.md read from the repo root.
   * Layer 2 must NOT promote a lesson the constitution already documents
   * (memory exists for knowledge invisible in code/docs), so the prompt feeds
   * these files into the dedup decision. Either field is null when the file is
   * absent or unreadable (graceful degrade — the prompt renders "(none)").
   */
  constitution: {
    claudeMd: string | null
    agentsMd: string | null
  }
}

/**
 * Read the project constitution files from the repo root for injection into
 * the Layer 2 prompt. Both reads degrade to null on any error (missing file,
 * permission, runtime where the file wasn't bundled) so consolidation never
 * fails just because a constitution file is absent.
 *
 * On Vercel these files only reach the serverless bundle because
 * `outputFileTracingIncludes` in next.config.mjs lists them for the API
 * routes; without that, `process.cwd()` would not contain them and both reads
 * would fall back to null.
 */
export async function loadConstitution(): Promise<Layer2Input['constitution']> {
  const root = process.cwd()
  const [claudeMd, agentsMd] = await Promise.all([
    readConstitutionFile(path.join(root, 'CLAUDE.md')),
    readConstitutionFile(path.join(root, 'AGENTS.md')),
  ])
  return { claudeMd, agentsMd }
}

async function readConstitutionFile(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf8')
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/** v1 cap on TASK rows per project. See repository docstring for rationale. */
export const LAYER2_TASK_MEMORY_LIMIT = 200

/**
 * Gather Layer 2 input for a single project. Returns null when there's
 * nothing to consolidate (project missing, no TASK-scope memories) — caller
 * should treat this as "skip this project".
 */
export async function getLayer2Input(
  projectId: string
): Promise<Layer2Input | null> {
  const project = await projectRepository.findById(projectId)
  if (!project) return null

  const taskMemories =
    await memoryRepository.findRecentTaskScopeMemoriesByProject(
      projectId,
      LAYER2_TASK_MEMORY_LIMIT
    )
  if (taskMemories.length === 0) return null

  const existingProjectMemories =
    await memoryRepository.findActiveProjectMemories(projectId)

  const constitution = await loadConstitution()

  return {
    project: {
      id: project.id,
      name: project.name,
      workspaceId: project.workspaceId,
    },
    taskMemories: taskMemories
      .filter((m): m is typeof m & { taskId: string } => m.taskId !== null)
      .map(m => ({
        id: m.id,
        taskId: m.taskId,
        category: m.category,
        content: m.content,
      })),
    existingProjectMemories: existingProjectMemories.map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    })),
    constitution,
  }
}
