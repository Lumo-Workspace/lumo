import type { MemoryCategory } from '@prisma/client'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import type { Layer2Fact } from './layer2-extract'

export interface Layer3Input {
  projectId: string
  workspaceId: string
  distilledFacts: Layer2Fact[]
  existingProjectMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
}

/**
 * Bundle the distilled facts from Layer 2 with the project's current active
 * project-scoped memories. The merge LLM needs both to decide ADD vs UPDATE
 * vs NOOP — without the existing set it would always ADD and produce
 * duplicate / conflicting rows.
 */
export async function getLayer3Input(args: {
  projectId: string
  workspaceId: string
  distilledFacts: Layer2Fact[]
}): Promise<Layer3Input> {
  const existing = await memoryRepository.findActiveProjectMemories(
    args.projectId
  )
  return {
    projectId: args.projectId,
    workspaceId: args.workspaceId,
    distilledFacts: args.distilledFacts,
    existingProjectMemories: existing.map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    })),
  }
}
