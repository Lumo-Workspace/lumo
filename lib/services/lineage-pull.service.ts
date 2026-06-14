import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { LineageFragmentType } from '@prisma/client'

export interface FragmentPullInput {
  sessionId: string
  fragmentType: LineageFragmentType
  fragmentId: string
}

/** Stamp pulledAt on the matching session-start edge when an agent pulls a fragment's body on demand (LUM-500). */
export async function recordFragmentPull(
  input: FragmentPullInput
): Promise<number> {
  return lineageEdgeRepository.recordPull(
    {
      sessionId: input.sessionId,
      fragmentType: input.fragmentType,
      fragmentId: input.fragmentId,
    },
    new Date()
  )
}
